---
title: "WorkManager: reliable background work and when not to use it"
slug: workmanager-background-work-android
date: 2026-11-02
order: 13
category: "Data & Networking"
tags: [workmanager, background, coroutines, testing]
summary: "WorkManager for deferrable, guaranteed work: constraints, CoroutineWorker, unique work, chains, backoff, expedited work, testing, and what it is not for."
---

WorkManager is the right tool for work that must eventually happen even if the user leaves the app or the process dies: uploading a draft, syncing a feed, compressing a file. It is the wrong tool for anything that must happen at an exact time or only while a screen is visible, and mixing those up is the most common source of "my worker runs late" bug reports. This post covers where the boundary is and how to use the API for the work it is built for.

## TL;DR

- Use WorkManager for **deferrable, guaranteed** work. It persists requests, survives process death and reboot, and honours constraints.
- Do not use it for exact-time alarms (use `AlarmManager`), work tied to a visible screen (use `viewModelScope`), or user-ongoing tasks such as playback (use a foreground service).
- Write workers as `CoroutineWorker`; return `Result.retry()` for transient failures and rely on backoff.
- Name your work with `enqueueUniqueWork` to avoid duplicates, and chain steps with `beginWith(...).then(...)`.
- Test the worker class directly with `TestListenableWorkerBuilder`, and the scheduling behaviour with `WorkManagerTestInitHelper`.

## When to use it, and when not to

| Need | Use |
| --- | --- |
| Upload or sync that must complete eventually | WorkManager |
| Periodic refresh (at least every 15 minutes, timing approximate) | WorkManager periodic work |
| Fire at 07:00 exactly | `AlarmManager` exact alarms (permission rules apply) |
| Load data for the screen the user is looking at | `viewModelScope` / lifecycle-aware coroutines |
| Music playback, navigation, active call | Foreground service |
| Long user-initiated transfer with progress UI | Foreground service or user-initiated data transfer job; check the current platform guidance |

WorkManager batches work with the system's job scheduling, so timing is never exact. A request with an initial delay of 10 minutes runs *no earlier* than 10 minutes. If the product requirement contains a clock time, it is not a WorkManager problem.

## A CoroutineWorker with constraints

```kotlin
// build.gradle.kts: androidx.work:work-runtime-ktx
// (check the release notes: recent versions may need only androidx.work:work-runtime)

class UploadDraftWorker(
    context: Context,
    params: WorkerParameters,
    private val repository: DraftRepository,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val draftId = inputData.getLong(KEY_DRAFT_ID, -1L)
        if (draftId < 0) return Result.failure()

        return try {
            repository.upload(draftId)
            Result.success(workDataOf(KEY_REMOTE_ID to repository.remoteIdFor(draftId)))
        } catch (e: IOException) {
            if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()
        }
    }

    companion object {
        const val KEY_DRAFT_ID = "draft_id"
        const val KEY_REMOTE_ID = "remote_id"
        private const val MAX_ATTEMPTS = 5
    }
}
```

`Worker` runs `doWork()` synchronously on a background executor; `CoroutineWorker` runs a `suspend` function on `Dispatchers.Default` and cancels the coroutine when the work is stopped. Prefer `CoroutineWorker` so cancellation (constraints no longer met, system stop, unique-work replace) actually interrupts your code. Input and output `Data` is small, key-value, and limited to about 10 KB; pass IDs, not payloads.

A worker with constructor dependencies needs a `WorkerFactory`. With Hilt, annotate with `@HiltWorker` and `@AssistedInject`; otherwise provide a custom factory through `Configuration.Provider` on your `Application`.

Request it with constraints, a backoff policy and a tag:

```kotlin
val request = OneTimeWorkRequestBuilder<UploadDraftWorker>()
    .setInputData(workDataOf(UploadDraftWorker.KEY_DRAFT_ID to draftId))
    .setConstraints(
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()
    )
    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
    .addTag("upload")
    .build()
```

Backoff applies after `Result.retry()`. The minimum is 10 seconds and the maximum is 5 hours. Note that constraints are checked by the system; a worker is not started until they hold and is stopped if they stop holding.

## Unique work, chaining and periodic work

Without a name, calling `enqueue` twice runs the work twice. Use unique work to declare what happens on a duplicate:

```kotlin
val workManager = WorkManager.getInstance(context)

workManager.enqueueUniqueWork(
    "upload-draft-$draftId",
    ExistingWorkPolicy.KEEP,        // ignore the new request if one is pending
    request,
)

workManager.enqueueUniquePeriodicWork(
    "sync-feed",
    ExistingPeriodicWorkPolicy.KEEP,
    PeriodicWorkRequestBuilder<SyncFeedWorker>(1, TimeUnit.HOURS)
        .setConstraints(
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        )
        .build(),
)
```

`REPLACE` cancels the existing work and starts the new request; `APPEND_OR_REPLACE` queues it after the current work. Periodic work has a 15-minute minimum interval, and `KEEP` is usually right so you do not reset the schedule every app start.

Chains run sequentially, and the output `Data` of one step is the input of the next:

```kotlin
workManager
    .beginUniqueWork("publish-$draftId", ExistingWorkPolicy.REPLACE, compressRequest)
    .then(uploadRequest)
    .then(notifyRequest)
    .enqueue()
```

If any step returns `failure()`, the rest of the chain is marked failed and does not run.

## Expedited work, progress and observation

For short work the user is waiting on that should start immediately, ask for expedited execution:

```kotlin
val expedited = OneTimeWorkRequestBuilder<SendMessageWorker>()
    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
    .build()
```

Expedited work is quota-limited, cannot have an initial delay, and cannot be periodic. On Android 11 and lower it runs as a foreground service, so your worker must override `getForegroundInfo()` to supply a notification. The out-of-quota policy decides whether the request degrades to normal work or is dropped.

Report progress from the worker and observe it as a `Flow`:

```kotlin
// inside CoroutineWorker.doWork()
setProgress(workDataOf("percent" to 40))

// in a ViewModel
val uploadProgress: Flow<Int> = WorkManager.getInstance(context)
    .getWorkInfosForUniqueWorkFlow("upload-draft-$draftId")
    .map { infos -> infos.firstOrNull()?.progress?.getInt("percent", 0) ?: 0 }
```

Observe `WorkInfo.state` for `SUCCEEDED`, `FAILED` or `CANCELLED`. Keep the observer in a lifecycle-aware scope; the work itself continues regardless.

## Testing

Test the worker's logic directly with `androidx.work:work-testing`:

```kotlin
@Test
fun `When upload fails with IOException then worker retries`() = runTest {
    val repository = FakeDraftRepository(failWith = IOException())
    val sut = TestListenableWorkerBuilder<UploadDraftWorker>(context)
        .setInputData(workDataOf(UploadDraftWorker.KEY_DRAFT_ID to 1L))
        .setWorkerFactory(object : WorkerFactory() {
            override fun createWorker(
                appContext: Context,
                workerClassName: String,
                workerParameters: WorkerParameters,
            ): ListenableWorker = UploadDraftWorker(appContext, workerParameters, repository)
        })
        .build()

    val actual = sut.doWork()

    assertEquals(expected = ListenableWorker.Result.retry(), actual = actual)
}
```

The `WorkerFactory` is what lets the worker take a fake repository. For scheduling behaviour (constraints, delays, periodic runs), initialise `WorkManagerTestInitHelper.initializeTestWorkManager(context, config)` and use `getTestDriver(context)` to mark constraints met or advance a delay. These tests need a device or Robolectric, because WorkManager uses a database.

## Common mistakes

- **Expecting exact timing.** A worker scheduled for "in 5 minutes" can run much later in Doze or under App Standby buckets. Use an alarm for clock-time requirements.
- **Doing work in `Worker.doWork()` that ignores cancellation.** A blocking loop keeps running after the system stopped the worker. Use `CoroutineWorker` and suspend-friendly APIs.
- **Enqueueing in `Application.onCreate` or `onResume` without unique names.** Each launch adds another copy. Use `enqueueUniqueWork` or `enqueueUniquePeriodicWork`.
- **Returning `Result.retry()` forever.** A permanent error (bad input, HTTP 4xx) retries with growing backoff indefinitely. Cap attempts with `runAttemptCount` and return `failure()`.
- **Passing large objects through `Data`.** Exceeding the size limit throws at build time. Store the payload in Room or a file and pass the ID.
- **Using WorkManager to keep something alive while the user watches it.** That is a foreground service's job; expedited work is for short tasks, not ongoing ones.

## If you know iOS

WorkManager's counterpart is `BGTaskScheduler` with `BGAppRefreshTask` and `BGProcessingTask`. The shared lesson is that neither platform gives exact timing: iOS decides when to run your task from usage patterns and power state, and Android decides from Doze, buckets and constraints. Android additionally gives you persistence and chaining out of the box. See the Equivalents page for the background-work mapping.

## Further reading

- [Schedule tasks with WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Getting started with WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started)
- [Test your Worker implementation](https://developer.android.com/develop/background-work/background-tasks/testing/persistent/worker-impl)
- [Background work overview](https://developer.android.com/develop/background-work/background-tasks)
