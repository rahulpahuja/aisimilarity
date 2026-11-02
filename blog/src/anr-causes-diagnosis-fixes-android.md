---
title: "Android ANRs: Causes, Reading Traces and Fixes"
slug: anr-causes-diagnosis-fixes-android
date: 2026-11-02
order: 19
category: "Platform & Performance"
tags: [anr, strictmode, main-thread, android-vitals, performance]
summary: "What triggers an Android ANR, how to read the main thread in a trace, how to catch blocking calls with StrictMode, and the fixes that actually remove the cause."
---

An ANR (Application Not Responding) means the system waited for your process to do something and it did not. It is not a crash, so there is no exception to read; the evidence is a thread dump that shows what the main thread was doing, or not doing, at the time. Since Google Play counts user-perceived ANRs against your app's vitals, it pays to know how to read that dump and which patterns cause most of them.

## TL;DR

- ANRs come from the main thread (or a component callback) failing to finish in time: input dispatch (5 seconds), service and broadcast callbacks, `startForeground` (5 seconds), and job callbacks.
- In a trace, look at the `main` thread (`tid=1`). If it is `Blocked`, find the lock holder. If it is running your code, that code is the cause. If it is idle in `nativePollOnce`, be suspicious of a late snapshot or a leaked sync barrier before blaming the app.
- Enable StrictMode in debug builds to catch disk, network and slow calls on the main thread before they reach users.
- Fix by removing the blocking dependency from the main thread: move I/O and CPU work off it, finish receivers quickly, and hand long work to WorkManager.
- Measure with Android vitals in Play Console. The bad-behavior thresholds are 0.47% of daily active users overall and 8% on a single device model.

## What triggers an ANR

The Android ANR documentation lists the situations that produce one:

| Trigger | Condition |
|---|---|
| Input dispatch | The app has not responded to an input event, such as a touch or key press, within 5 seconds |
| Service | A service did not finish `onCreate` and `onStartCommand`/`onBind` in time |
| Foreground service start | `startForegroundService` was called but the service did not call `startForeground` within 5 seconds |
| Broadcast receiver | `onReceive` did not finish in time, or `goAsync()` was called and `PendingResult.finish()` never was |
| Job callbacks | `JobService.onStartJob` or `onStopJob` did not return within a few seconds |

The documentation gives the exact input and foreground-service numbers but describes the other deadlines loosely, and they can differ by process state. Treat them as "shorter than you think" and do not build logic around a specific figure.

The common thread is that the callback runs on the main thread, and anything the main thread waits for counts against it. That includes work you did not write: a synchronous Binder call into a slow system service, a lock held by a worker doing disk I/O, or a library initialized inside `Application.onCreate`.

## Reading a trace

Get traces from the ANR clusters in Play Console (Android vitals), from your crash reporter, or from `ApplicationExitInfo` on the device. On Android 11 and up, `getHistoricalProcessExitReasons` returns entries whose reason is `REASON_ANR`, and each can expose the trace:

```kotlin
// Run off the main thread: reading the trace is I/O.
fun collectAnrTraces(context: Context, upload: (String) -> Unit) {
    val am = context.getSystemService(ActivityManager::class.java)
    am.getHistoricalProcessExitReasons(context.packageName, 0, 5)
        .filter { it.reason == ApplicationExitInfo.REASON_ANR }
        .forEach { info ->
            info.traceInputStream?.bufferedReader()?.use { upload(it.readText()) }
        }
}
```

On a device you control, `adb bugreport` includes the ANR traces. Reading `/data/anr` directly needs a rooted or userdebug device.

Find the main thread first. An illustrative, simplified excerpt:

```bash
"main" prio=5 tid=1 Blocked
  at com.example.cache.DiskCache.get(DiskCache.kt:42)
  - waiting to lock <0x0a1b2c3d> (a java.lang.Object) held by thread 17
  at com.example.ui.FeedAdapter.onBindViewHolder(FeedAdapter.kt:88)

"pool-3-thread-2" prio=5 tid=17 Runnable
  at java.io.FileInputStream.read(Native Method)
  at com.example.cache.DiskCache.rebuildIndex(DiskCache.kt:120)
```

How to interpret what you see:

- **Main thread running or blocked in your code.** If it is in `readBytes`, a SQL query or a `Future.get()`, that call is the cause. If it is `Blocked` on a lock, read the holder thread (17 above) instead; the holder's workload is the real problem, here file I/O under a lock the UI also takes.
- **Main thread idle in `MessageQueue.nativePollOnce`.** The thread is waiting for work, so the trace may have been taken after a slow message already finished, or the system was starved. A completed slow message is a delayed snapshot, not proof of a healthy app. On Android 15 and up, the trace can also include a record of recent slow main-thread messages, which helps here.
- **Sync barrier leak.** Updating an attached View from a background thread can, in a race, leave a synchronization barrier in the main looper. The main thread keeps rendering frames while ordinary synchronous messages, such as component callbacks, starve behind it. Android's ANR guidance says the platform race is fixed in Android 17 and older versions remain vulnerable. If your trace shows an idle main thread with a background thread touching views, make all View mutations happen on the main thread.
- **System under load.** If CPU, memory or I/O are saturated by other processes and your app is a passive victim, there may be nothing to fix in app code. Do not invent a workaround for it.

Work in that order: look for a concrete blocking dependency in the app first, then app-driven resource overload, and only then call it external starvation.

## Catch it before users do: StrictMode

StrictMode reports main-thread disk, network and slow calls during development. Enable it for debuggable builds only.

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debuggable) {
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder()
                    .detectAll()
                    .penaltyLog()
                    .build()
            )
            StrictMode.setVmPolicy(
                StrictMode.VmPolicy.Builder()
                    .detectLeakedClosableObjects()
                    .penaltyLog()
                    .build()
            )
        }
    }
}
```

Start with `penaltyLog()`, work through the violations that are yours, and consider `penaltyDeath()` on CI builds once the log is clean. Violations inside third-party SDKs are worth reporting upstream, but you may need to suppress them locally.

## Fixes that remove the cause

**Move blocking work off the main thread.** Never use `runBlocking` in UI code. Launch from a scope that is tied to the screen and switch dispatchers only around the slow part:

```kotlin
class ProfileViewModel(private val repo: ProfileRepository) : ViewModel() {
    private val _state = MutableStateFlow<ProfileState>(ProfileState.Loading)
    val state: StateFlow<ProfileState> = _state

    fun load() {
        viewModelScope.launch {
            val profile = withContext(Dispatchers.IO) { repo.readProfile() }
            _state.value = ProfileState.Ready(profile)
        }
    }
}
```

**Keep broadcast receivers short.** `onReceive` runs on the main thread. For anything beyond a few lines, hand the work to WorkManager, which runs it outside the receiver's lifetime:

```kotlin
class SyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        WorkManager.getInstance(context)
            .enqueue(OneTimeWorkRequestBuilder<SyncWorker>().build())
    }
}
```

If you use `goAsync()`, treat `finish()` as mandatory in every path, including failures, and keep the work short:

```kotlin
override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    CoroutineScope(Dispatchers.Default).launch {
        try {
            quickWork(context)
        } finally {
            pending.finish()
        }
    }
}
```

**Call `startForeground` immediately.** After `startForegroundService`, post the notification at the top of `onStartCommand` or `onCreate`, before any setup work.

**Defer startup work.** Anything heavy in `Application.onCreate` or a `ContentProvider.onCreate` delays every launch and every cold component start, including the process that is being started to deliver a broadcast. Initialize lazily or on a background thread.

**Reduce lock contention.** If the main thread and a worker share a lock, either remove the lock from the main-thread path (read an immutable snapshot) or move the long operation out from under the lock.

**Reconsider synchronous storage APIs.** Synchronous reads from `SharedPreferences` happen on the thread that calls them, and writes with `apply()` are written in the background but can still be waited on at some lifecycle points. If your preferences file is large or hot, move to a coroutine-friendly store such as Jetpack DataStore.

## Common mistakes

- **Using `runBlocking` or `Future.get()` on the main thread.** It turns any slow dependency into a frozen UI. Launch a coroutine and update state when it completes.
- **Doing long work in `onReceive`.** The receiver has a deadline, and the app can be killed mid-work. Use WorkManager for anything non-trivial.
- **Forgetting `pending.finish()` on an error path.** An exception between `goAsync()` and `finish()` leaves the receiver open until it times out. Put `finish()` in a `finally`.
- **Treating `nativePollOnce` as proof the app is fine.** An idle main thread can mean a delayed snapshot or a leaked sync barrier. Check the capture delay and for background View mutation.
- **Blaming the waiting thread when it is `Blocked`.** The thread holding the lock is the one with the problem. Read its stack.
- **Enabling StrictMode in release.** It adds overhead and noise. Gate it on debuggable builds.
- **Ignoring Android vitals until a bad-behavior threshold is crossed.** Track the user-perceived ANR rate per release and per device model, and fix the largest cluster first.

## If you know iOS

iOS has no ANR dialog, and the system watchdog kills an app that blocks the main thread too long during launch or a lifecycle transition, which shows up as a crash report rather than a dialog. The causes are the same: synchronous I/O, locks and long work on the main thread. Instruments (Time Profiler and the Hangs instrument) covers the trace-reading side, and MetricKit hang diagnostics are the closest counterpart to Android vitals ANR clusters. See the Equivalents page for the full mapping.

## Further reading

- [ANRs (Android developers)](https://developer.android.com/topic/performance/vitals/anr)
- [StrictMode reference](https://developer.android.com/reference/android/os/StrictMode)
- [ApplicationExitInfo reference](https://developer.android.com/reference/android/app/ApplicationExitInfo)
- [Play Console help: Android vitals metrics and bad behavior thresholds](https://support.google.com/googleplay/android-developer/answer/9844486)
