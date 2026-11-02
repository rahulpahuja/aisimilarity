---
title: "Kotlin Coroutines on Android: Structured Concurrency Done Right"
slug: kotlin-coroutines-structured-concurrency-android
date: 2026-11-02
order: 6
category: "Kotlin & Architecture"
tags: [kotlin, coroutines, viewmodel, lifecycle, concurrency]
summary: "Scopes, dispatchers, cooperative cancellation and exception handling for Android coroutines, plus the mistakes that leak work or swallow errors."
---

A screen fires three network calls, the user presses Back, and the calls keep running against a dead screen. Or one of the three throws and silently takes the other two down with it. Or a `try/catch` around a suspend call eats the exception that was supposed to cancel the coroutine. All three are the same underlying issue: the coroutine was not tied to the right owner, or the code fought the cancellation and exception rules instead of using them.

## TL;DR

- Every coroutine runs inside a scope. When the scope is cancelled, every child is cancelled; when a child fails, its parent and siblings are cancelled too (unless you opt out with a supervisor).
- Launch UI-bound work in `viewModelScope` or `lifecycleScope`; never in `GlobalScope`.
- A suspend function should be main-safe: it switches dispatcher itself with `withContext`, so callers never have to think about it.
- Cancellation is cooperative. Suspending library calls check for it; your own loops must call `ensureActive()` or `yield()`, and you must never swallow `CancellationException`.
- `CoroutineExceptionHandler` is a last resort for root coroutines, not a replacement for `try/catch`.

## Structured concurrency in one paragraph

A coroutine started with `launch` or `async` becomes a child of the `Job` in the scope that started it. The parent does not complete until its children do, cancelling the parent cancels the children, and an uncaught failure in a child propagates upward. That tree is what makes `suspend` code safe to compose: when `loadDashboard()` returns or throws, nothing it started is still running. Everything else in this post is a consequence of that rule.

## Pick the right scope

Android gives you two lifecycle-aware scopes out of the box.

- `viewModelScope` lives as long as the `ViewModel`. It uses `Dispatchers.Main.immediate` and a `SupervisorJob`, so one failed child does not cancel its siblings. It is cancelled in `onCleared()`.
- `lifecycleScope` (on an `Activity`, `Fragment`, or the view lifecycle owner) is cancelled when that lifecycle is destroyed. It also runs on `Dispatchers.Main.immediate`.

```kotlin
class ProfileViewModel(
    private val repository: ProfileRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<ProfileState>(ProfileState.Loading)
    val state: StateFlow<ProfileState> = _state

    fun load(id: String) {
        viewModelScope.launch {
            _state.value = try {
                ProfileState.Content(repository.profile(id))
            } catch (e: IOException) {
                ProfileState.Error(e.message)
            }
        }
    }
}
```

Work that must survive the screen (an upload the user started, a sync) does not belong in either scope. Hand it to WorkManager, or to an application-level scope you own: a `CoroutineScope(SupervisorJob() + dispatcher)` provided by your DI graph and injected where needed. That keeps the work structured, named and testable.

`GlobalScope` is annotated `@DelicateCoroutinesApi` for a reason. Coroutines launched in it are children of nothing: nobody cancels them, nobody observes their failures, and a test cannot wait for them. If you reach for it, you almost always want an injected application scope instead.

## Dispatchers and main-safety

- `Dispatchers.Main` (and `Main.immediate`) for UI and state updates.
- `Dispatchers.Default` for CPU-bound work such as sorting, parsing, diffing. Its pool is sized to the number of cores.
- `Dispatchers.IO` for blocking I/O such as files and blocking database or network clients. It shares threads with `Default` but allows many more concurrent blocking calls (64 by default).

The convention recommended in Android's coroutine best practices is that suspend functions are *main-safe*: callable from the main thread without blocking it. The function that does the blocking work is the one that switches thread.

```kotlin
class ProfileRepository(
    private val api: ProfileApi,
    private val dao: ProfileDao,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    suspend fun profile(id: String): Profile = withContext(io) {
        dao.find(id) ?: api.fetch(id).also { dao.insert(it) }
    }
}
```

Inject the dispatcher instead of hard-coding `Dispatchers.IO`. Tests can then pass a test dispatcher and control time. Note that many suspend APIs (Retrofit's suspend functions, Room's suspend DAO methods) already move off the main thread themselves, so a `withContext(io)` around only those calls is redundant; add it around code that really blocks.

For parallel work inside a single operation, use `coroutineScope`:

```kotlin
suspend fun loadDashboard(): Dashboard = coroutineScope {
    val profile = async { api.profile() }
    val feed = async { api.feed() }
    Dashboard(profile.await(), feed.await())
}
```

If `feed()` throws, `profile()` is cancelled and the exception propagates out of `loadDashboard()`. That is the right behaviour when the dashboard is useless without both halves.

## Cancellation is cooperative

Cancelling a coroutine sets a flag and makes the next cancellable suspension point throw `CancellationException`. Functions in `kotlinx.coroutines` and well-behaved libraries check it. A tight loop that never suspends does not:

```kotlin
suspend fun hashAll(files: List<File>): List<String> =
    withContext(Dispatchers.Default) {
        files.map { file ->
            ensureActive()          // throws if the scope was cancelled
            sha256(file)
        }
    }
```

Use `ensureActive()` (or `yield()`, which also lets other coroutines run) between units of work. Blocking calls such as `InputStream.read()` are not cancellable at all; they finish when they finish.

Two rules follow from the exception-based design:

1. Never swallow `CancellationException`. A bare `catch (e: Exception)` or `runCatching` around a suspend call catches it and the coroutine carries on as if it had not been cancelled. Rethrow it.
2. Cleanup that itself suspends must run in `withContext(NonCancellable)`, because the coroutine is already cancelled inside `finally`.

```kotlin
inline fun <T> runCatchingCancellable(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        Result.failure(e)
    }

suspend fun upload(file: File) {
    try {
        api.upload(file)
    } finally {
        withContext(NonCancellable) { dao.markUploadFinished(file.name) }
    }
}
```

## Exceptions: where they go

Inside `launch`, an uncaught exception propagates to the parent, which cancels all of its children. When it reaches a root coroutine that has no `CoroutineExceptionHandler`, it goes to the thread's uncaught-exception handler, which on Android crashes the app. Inside `async`, the exception is held until you call `await()`, but it *also* propagates to the parent immediately, so wrapping only `await()` in `try/catch` is not enough in a regular scope.

Choose the boundary deliberately:

- `try/catch` inside the coroutine, around the suspend call, for errors you can recover from (the default).
- `supervisorScope` when children are independent and one failure must not cancel the rest.
- `CoroutineExceptionHandler` only as a final logging or reporting hook.

```kotlin
suspend fun loadWidgets(ids: List<String>): List<Result<Widget>> =
    supervisorScope {
        ids.map { id -> async { runCatchingCancellable { api.widget(id) } } }
            .awaitAll()
    }
```

Here each widget succeeds or fails on its own, and the caller gets a list it can render partially.

`CoroutineExceptionHandler` has narrow semantics:

- It only takes effect on a *root* coroutine (or a direct child of a `supervisorScope`). A handler passed to a nested `launch` is ignored, because the child hands its exception to its parent.
- It is never invoked for `async`; the exception surfaces through `await()`.
- By the time it runs, the coroutine has already failed and its scope is cancelled. You can log or show an error, not resume.

```kotlin
private val handler = CoroutineExceptionHandler { _, e -> crashReporter.log(e) }

fun refresh() {
    viewModelScope.launch(handler) { repository.refresh() }
}
```

Also note that `try { scope.launch { boom() } } catch (e: Exception) { }` catches nothing: `launch` returns immediately and the failure happens later on the coroutine.

## Common mistakes

- **Using `GlobalScope.launch` for fire-and-forget.** Consequence: unowned work that outlives its screen and cannot be tested. Fix: inject an application scope, or use WorkManager if it must survive process death.
- **Catching `Exception` or using `runCatching` around suspend calls.** Consequence: cancellation is swallowed and work continues after the user left. Fix: rethrow `CancellationException` or use a helper like `runCatchingCancellable`.
- **Hard-coding `Dispatchers.IO` in classes.** Consequence: tests cannot control execution and become flaky. Fix: inject a `CoroutineDispatcher`.
- **Long CPU loops without `ensureActive()`.** Consequence: cancelled work keeps burning battery until the loop ends. Fix: check between iterations.
- **Passing a `CoroutineExceptionHandler` to a child coroutine.** Consequence: it is silently ignored and the app crashes anyway. Fix: install it on the root `launch`, or handle the error with `try/catch`.
- **Creating a new `CoroutineScope(...)` per call and never cancelling it.** Consequence: it is an unstructured leak. Fix: reuse `viewModelScope`, or a long-lived scope with an explicit owner.

## If you know iOS

Swift concurrency has the same model under different names: a `Task` started inside another `Task` via `async let` or a `TaskGroup` is a structured child, and cancellation is cooperative there too (`Task.checkCancellation()` plays the role of `ensureActive()`). `viewModelScope` is roughly the lifetime a SwiftUI `.task` modifier gives you, and `@MainActor` corresponds to `Dispatchers.Main`. A notable difference is that a plain `Task { }` is *unstructured* even when created inside another task, so it is not cancelled with its creator, and the same ownership questions apply as with `GlobalScope`. See the Equivalents page for the full mapping.

## Further reading

- [Kotlin coroutines guide](https://kotlinlang.org/docs/coroutines-guide.html)
- [Cancellation and timeouts](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [Coroutine exceptions handling](https://kotlinlang.org/docs/exception-handling.html)
- [Best practices for coroutines in Android](https://developer.android.com/kotlin/coroutines/coroutines-best-practices)
