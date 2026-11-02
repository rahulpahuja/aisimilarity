---
title: "Android Lifecycle, Configuration Changes and Process Death"
slug: android-lifecycle-process-death-configuration-changes
date: 2026-11-02
order: 10
category: "Kotlin & Architecture"
tags: [lifecycle, process-death, savedstate, viewmodel, testing]
summary: "What survives rotation versus process death, how to save and restore state with SavedStateHandle and rememberSaveable, and how to actually test process death."
---

A user fills in half a form, switches to the camera app to copy a number, and comes back two minutes later to an empty screen. Nothing crashed. The system needed memory, killed your process while it was in the background, and then rebuilt the screen from whatever little you had saved. Most apps are tested against rotation and never against this, so most apps have a bug here.

## TL;DR

- There are three different "restarts": the Activity is paused or stopped but alive; it is destroyed and recreated by a configuration change with the process alive; the whole process is killed and later restored.
- A `ViewModel` survives configuration changes, not process death. `SavedStateHandle`, `rememberSaveable` and `onSaveInstanceState` survive both. Only persistent storage survives everything.
- Do not count on `onDestroy()` (or any callback) running when the system kills your process. Persist what matters when it changes, or at the latest in `onStop()`.
- Test process death for real with `adb shell am kill` while the app is in the background.
- Opting out of recreation with `android:configChanges` is a last resort, not a fix for state bugs.

## The lifecycle, minus the folklore

For an Activity, the callbacks you will use are these:

| Callback | State of the screen | Typical use |
|---|---|---|
| `onCreate` | Being created | Inflate or `setContent`, restore from `savedInstanceState` |
| `onStart` | Visible | Start things the user can see (collectors, listeners) |
| `onResume` | In foreground, interactive | Resume camera, sensors, exclusive resources |
| `onPause` | Losing focus | Release exclusive resources; may still be visible (multi-window) |
| `onStop` | Not visible | Release heavy resources, persist unsaved edits |
| `onDestroy` | Finishing or being recreated | Final cleanup, not a place to save data |

`onSaveInstanceState` is called after `onStop` on apps targeting API 28 and above. Two points trip people up. `onPause` does not mean invisible: in multi-window and picture-in-picture the Activity can be paused yet on screen, so tie "visible" work to `onStart`/`onStop`. And the system may kill a stopped process with no further callback, which is why `onDestroy` is not a save point.

Fragments add a second lifecycle: the view's. A Fragment instance can outlive its view (for example on the back stack), so anything that touches views must use `viewLifecycleOwner` and be released in `onDestroyView`:

```kotlin
class DetailFragment : Fragment(R.layout.fragment_detail) {
    private var _binding: FragmentDetailBinding? = null
    private val binding get() = _binding!!

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        _binding = FragmentDetailBinding.bind(view)
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { binding.title.text = it.title }
            }
        }
    }

    override fun onDestroyView() {
        _binding = null   // otherwise the Fragment retains its destroyed views
        super.onDestroyView()
    }
}
```

In Compose, observe lifecycle events declaratively instead of registering observers by hand:

```kotlin
LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
    viewModel.onScreenResumed()
}
```

## What survives what

Rotation, a locale change, a dark-mode toggle and a window resize are *configuration changes*. By default the system destroys the Activity and creates a new instance, so any field in the old instance is gone. Process death is harsher: the process, its statics, its singletons and every `ViewModel` disappear, and Android recreates the Activity (and the back stack) with only the saved instance state.

| Where state lives | Configuration change | Process death |
|---|---|---|
| Activity or Fragment field | Lost | Lost |
| Compose `remember` | Lost | Lost |
| `ViewModel` field | Survives | Lost |
| `SavedStateHandle`, `rememberSaveable`, `onSaveInstanceState` | Survives | Survives |
| Database, DataStore, file | Survives | Survives |

The practical rule: classify each piece of screen state. If it is *user input that cannot be recomputed* (a typed draft, a selected id, the current query), keep it in saved state. If it is *derived data*, re-load it from the repository after restoration. If it is *something the user would be furious to lose*, write it to disk as it changes.

In Compose, `rememberSaveable` is the saved-state version of `remember`. It works out of the box for anything that can go in a `Bundle`, including `Parcelable` types:

```kotlin
@Parcelize
data class Filter(val tags: List<String> = emptyList(), val onlyUnread: Boolean = false) : Parcelable

@Composable
fun InboxScreen() {
    var filter by rememberSaveable { mutableStateOf(Filter()) }
    var menuOpen by remember { mutableStateOf(false) }   // fine to lose
    // ...
}
```

For types a `Bundle` cannot hold, pass a `Saver` (`listSaver`, `mapSaver`) to `rememberSaveable`, or better, keep the value in the `ViewModel` and save only the input that rebuilds it.

In a `ViewModel`, use `SavedStateHandle` as described in the ViewModel post:

```kotlin
class DraftViewModel(
    private val savedStateHandle: SavedStateHandle,
    private val drafts: DraftStore,
) : ViewModel() {

    val text: StateFlow<String> = savedStateHandle.getStateFlow("text", "")

    fun onTextChanged(value: String) {
        savedStateHandle["text"] = value        // survives process death
        viewModelScope.launch { drafts.save(value) }   // survives everything
    }
}
```

Keep saved state small. It is written into a `Bundle` that crosses a binder transaction with a size limit shared by the whole process, and overshooting it throws `TransactionTooLargeException`. Never put a list of results or a bitmap in it.

## Avoid the configChanges escape hatch

Declaring `android:configChanges="orientation|screenSize|..."` in the manifest stops the system from recreating the Activity for those changes and calls `onConfigurationChanged` instead. It removes a symptom of lost state while leaving process death untouched, and it means you take on the job of updating resources and layouts by hand. The platform documentation treats it as a last resort. Fix the state handling; with a `ViewModel` and saved state, recreation is cheap.

## Testing it for real

Rotation is the easy one. In instrumented tests, `ActivityScenario.recreate()` destroys and recreates the Activity through the real save and restore path. For Compose state, `StateRestorationTester` lets you emulate restoration of `rememberSaveable` values inside a composition test.

Process death needs a real kill. The steps:

1. Run the app and navigate to the screen with state you care about; enter some input.
2. Press Home so the app is in the background.
3. Kill the process:

```bash
adb shell am kill com.example.yourapp
```

4. Reopen the app from the Recents screen, so the system restores the existing task.

`am kill` only kills processes that are safe to kill, which is why the app must be in the background. Do not substitute `am force-stop`: a force stop clears the app's saved task state, so you will see a fresh start rather than a restoration.

The developer option "Don't keep activities" is a useful extra check. It destroys each Activity as soon as you leave it, and exercises saved-state restoration quickly. But the process stays alive, so statics and singletons survive, and it hides bugs that depend on them. Treat it as a quick filter and the `am kill` run as the real test.

## Background restrictions, briefly

Killing is one threat to background work; being prevented from running is another. At a high level: Android limits background services (since Android 8), restricts starting foreground services from the background on recent versions, requires a declared foreground service type on recent target SDKs, and applies Doze and App Standby to defer work when the device is idle. The consistent guidance is to use WorkManager for deferrable work that must eventually run, a foreground service only for user-visible ongoing tasks, and to treat every other background thread as something the system may stop. Check the current docs for the exact behaviour on the API level you target, since these rules change nearly every release.

## Common mistakes

- **Treating `ViewModel` as persistence.** Consequence: state vanishes after process death while rotation tests pass. Fix: put rebuilding inputs in `SavedStateHandle` and user data in storage.
- **Saving in `onDestroy`.** Consequence: the callback may never run if the process is killed. Fix: save when the data changes, or in `onStop`.
- **Holding view bindings after `onDestroyView`.** Consequence: leaked views and stale-reference crashes. Fix: null the binding and use `viewLifecycleOwner` for observers.
- **Storing big objects in `Bundle` state.** Consequence: `TransactionTooLargeException`. Fix: save ids or inputs, reload the rest.
- **Testing only rotation.** Consequence: process-death bugs ship. Fix: `am kill` check on every screen with input.
- **Using `android:configChanges` to avoid recreation.** Consequence: you still lose state on process death and now handle configuration manually. Fix: remove it and manage state properly.
- **Relying on singletons being initialised.** Consequence: after process death a deep screen is restored before the code that fills a singleton has run. Fix: have each screen load its own dependencies, via injection.

## If you know iOS

iOS has the same two situations under different names. Backgrounded apps can be terminated without notice, and UIKit and SwiftUI offer scene-based state restoration, with `@SceneStorage` as the SwiftUI counterpart of `rememberSaveable` or `SavedStateHandle`. The big structural difference is configuration changes: rotating a device does not destroy and recreate a SwiftUI view hierarchy the way it does an Android Activity, so there is no iOS analogue of the `ViewModel`-survives-recreation guarantee. The habit of verifying restoration after the system reclaims a backgrounded app applies on both platforms. See the Equivalents page.

## Further reading

- [Activity lifecycle](https://developer.android.com/guide/components/activities/activity-lifecycle)
- [Save UI states](https://developer.android.com/topic/libraries/architecture/saving-states)
- [Handle configuration changes](https://developer.android.com/guide/topics/resources/runtime-changes)
- [Background work overview](https://developer.android.com/develop/background-work/background-tasks)
