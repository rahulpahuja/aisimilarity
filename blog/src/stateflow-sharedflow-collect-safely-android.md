---
title: "StateFlow, SharedFlow and Safe Flow Collection on Android"
slug: stateflow-sharedflow-collect-safely-android
date: 2026-11-02
order: 7
category: "Kotlin & Architecture"
tags: [kotlin, flow, stateflow, sharedflow, lifecycle, compose]
summary: "When to use Flow, StateFlow or SharedFlow, how stateIn and WhileSubscribed work, and how to collect from the UI without leaks or lost one-off events."
---

Two bugs show up in almost every Android codebase that adopts Flow. The first: a screen collects a database flow from `lifecycleScope.launch`, the user sends the app to the background, and the upstream query keeps running because nothing told it to stop. The second: a "show snackbar" event is emitted while the screen is rotating, no one is collecting, and the message vanishes. Both come from treating all flows as the same thing. They are not, and the choices below decide which of those bugs you get.

## TL;DR

- `Flow` is cold: it does nothing until collected, and each collector runs the producer again. Use it in repositories and data layers.
- `StateFlow` is hot and always holds a current value. It is the default for UI state exposed by a `ViewModel`.
- `SharedFlow` is hot with configurable replay and buffering, with no "current value". It fits broadcast-style signals, not guaranteed-delivery events.
- Convert cold to hot in the `ViewModel` with `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)`.
- Collect in the UI with `repeatOnLifecycle(STARTED)` (Views) or `collectAsStateWithLifecycle()` (Compose). Model one-off events as state that the UI consumes.

## The three types

| | Flow | StateFlow | SharedFlow |
|---|---|---|---|
| Hot or cold | Cold | Hot | Hot |
| Initial value | None | Required | None |
| Replay to new collectors | n/a | Latest value only | Configurable (`replay`) |
| Equal values | Emitted | Skipped (equality-based) | Emitted |
| Slow collector | Producer waits | Conflated (latest wins) | Per `onBufferOverflow` |
| Completes | Yes | Never | Never |

Practical consequences:

- `StateFlow` compares new values with `equals`. Emitting an equal object is a no-op, which is good for UI state and surprising for events: sending the same event twice may deliver it once.
- `StateFlow` is conflated. If you set `value` three times before the collector runs, it sees only the last. UI state does not need the intermediate ones; an event stream usually does.
- `SharedFlow(replay = 0)` with no collectors drops the value. That is the root of the "lost snackbar" bug above.

## Expose state with stateIn

Repositories return cold flows; the `ViewModel` turns them into one hot state holder.

```kotlin
data class ItemsUiState(
    val items: List<Item> = emptyList(),
    val isLoading: Boolean = true,
    val message: String? = null, // used in the one-off events section below
)

class ItemsViewModel(
    repository: ItemRepository,
) : ViewModel() {

    val uiState: StateFlow<ItemsUiState> = repository.observeItems()
        .map { ItemsUiState(items = it, isLoading = false) }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = ItemsUiState(),
        )
}
```

`SharingStarted.WhileSubscribed(5_000)` keeps the upstream alive for five seconds after the last collector disappears. A configuration change (rotation, dark-mode toggle) re-attaches the UI well inside that window, so the database query is not restarted; a user who truly leaves the screen stops costing you a query and a socket after five seconds. The 5 second figure is the commonly used convention, not a magic constant; anything longer than your configuration-change gap works.

The alternatives: `Eagerly` starts immediately and never stops, `Lazily` starts at the first collector and never stops. For anything backed by a database or socket, `WhileSubscribed` is usually what you want.

When upstream state is a pure function of other state (`combine`, `flatMapLatest` over a query string), do the same: build the pipeline once as a property, not inside a function that creates a fresh `stateIn` on each call.

For state you mutate directly, keep the mutable flow private and use `update` for read-modify-write:

```kotlin
private val _uiState = MutableStateFlow(ItemsUiState())
val uiState: StateFlow<ItemsUiState> = _uiState.asStateFlow()

fun onItemAdded(item: Item) {
    _uiState.update { it.copy(items = it.items + item) }
}
```

`update` is an atomic compare-and-set loop. `_uiState.value = _uiState.value.copy(...)` is a race if two coroutines do it at once.

## Collect safely

A collector in `lifecycleScope.launch { flow.collect { } }` keeps running while the screen is stopped, because `lifecycleScope` only cancels on destroy. For a hot flow that means rendering into an invisible UI; for a `stateIn(WhileSubscribed)` flow it also means the upstream never stops. Use `repeatOnLifecycle`, which starts a fresh coroutine each time the lifecycle reaches the given state and cancels it when it drops below.

```kotlin
override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
    viewLifecycleOwner.lifecycleScope.launch {
        viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch { viewModel.uiState.collect(::render) }
            launch { viewModel.sideData.collect(::renderSide) }
        }
    }
}
```

Two details matter. In a Fragment, use `viewLifecycleOwner`, not the Fragment's own lifecycle, since the view can be destroyed while the Fragment lives on. And `collect` suspends forever, so each flow needs its own `launch` inside the block; two sequential `collect` calls would never reach the second.

`launchWhenStarted` and its siblings are deprecated for this reason: they pause the coroutine rather than cancel it, so upstream producers stay active.

In Compose, the equivalent is one line, from the `androidx.lifecycle:lifecycle-runtime-compose` artifact:

```kotlin
@Composable
fun ItemsRoute(viewModel: ItemsViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    ItemsScreen(state)
}
```

`collectAsStateWithLifecycle` stops collecting below `STARTED` by default. Plain `collectAsState()` has no such awareness on Android and keeps collecting for as long as the composition is alive.

## One-off events

Navigation commands, snackbars and toasts are the awkward case. The options all have a failure mode:

- **`MutableSharedFlow()` with `replay = 0`:** the event is dropped when nobody is collecting, for example mid-rotation.
- **`replay = 1`:** the event is delivered again to every new collector, so the snackbar reappears after rotation.
- **`Channel` exposed with `receiveAsFlow()`:** each event goes to one collector, and buffered events wait for it. It is better than the two above, but an event can still be lost if the collector is cancelled while handling it, and you have to reason about delivery guarantees yourself.

The approach in Android's architecture guidance is to treat events as state: the `ViewModel` records that something needs to be shown, the UI shows it and tells the `ViewModel` it was consumed. State survives rotation and the missing-collector window by construction. The snippets below use the `MutableStateFlow` from the previous section; if your state comes from a `stateIn` pipeline, feed the pending message in as another upstream flow with `combine`.

```kotlin
fun onSaveFailed() {
    _uiState.update { it.copy(message = "Could not save") }
}

fun onMessageShown() {
    _uiState.update { it.copy(message = null) }
}
```

```kotlin
@Composable
fun ItemsScreen(
    state: ItemsUiState,
    snackbarHostState: SnackbarHostState,
    onMessageShown: () -> Unit,
) {
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            onMessageShown()
        }
    }
    // rest of the screen
}
```

Navigation works the same way: put a `navigateTo` value in state, navigate, then clear it. It feels verbose the first time and then stops being something you debug.

## Common mistakes

- **Collecting in `lifecycleScope.launch` without `repeatOnLifecycle`.** Consequence: collection and, with `WhileSubscribed`, the upstream continue in the background, wasting battery and sometimes crashing on UI access. Fix: wrap in `repeatOnLifecycle(STARTED)` or use `collectAsStateWithLifecycle()`.
- **Two `collect` calls back to back in one coroutine.** Consequence: the second flow is never collected. Fix: one `launch` per flow.
- **Exposing `MutableStateFlow` publicly.** Consequence: any layer can write UI state and the single-writer guarantee is gone. Fix: private mutable property, public `asStateFlow()`.
- **Mutating a collection inside state.** Consequence: with a `MutableList` in the state object, the same instance is `equals` to itself, so `StateFlow` emits nothing. Fix: immutable data classes and `copy`.
- **Using `SharedFlow` for events that must not be lost.** Consequence: dropped snackbars and navigation during rotation. Fix: model the event as consumed state.
- **Calling `stateIn` inside a function that is invoked per recomposition or per call.** Consequence: a new hot flow and upstream subscription each time. Fix: define it once as a property.
- **Emitting from a different coroutine context inside a `flow { }` builder.** Consequence: `IllegalStateException` for violating context preservation. Fix: use `flowOn(dispatcher)` on the flow.

## If you know iOS

`StateFlow` is closest to Combine's `CurrentValueSubject` or an `@Published` property: always a current value, new subscribers get it immediately. `SharedFlow` lines up with `PassthroughSubject`, including the same "no subscriber, event gone" behaviour. In SwiftUI the lifecycle-aware collection is mostly handled for you: `.task` starts when a view appears and cancels when it disappears, which is what `repeatOnLifecycle` and `collectAsStateWithLifecycle` replicate on Android. Treating one-off events as state is also the idiomatic SwiftUI answer (a published optional driving an alert or sheet). See the Equivalents page for the full mapping.

## Further reading

- [StateFlow and SharedFlow on Android](https://developer.android.com/kotlin/flow/stateflow-and-sharedflow)
- [UI events in the architecture guide](https://developer.android.com/topic/architecture/ui-layer/events)
- [Asynchronous Flow in the Kotlin docs](https://kotlinlang.org/docs/flow.html)
- [Kotlin coroutines on Android: flow section](https://developer.android.com/kotlin/flow)
