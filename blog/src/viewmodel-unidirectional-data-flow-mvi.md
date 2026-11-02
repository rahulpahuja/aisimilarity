---
title: "ViewModel, Unidirectional Data Flow and a Framework-Free MVI"
slug: viewmodel-unidirectional-data-flow-mvi
date: 2026-11-02
order: 8
category: "Kotlin & Architecture"
tags: [viewmodel, mvi, architecture, state, savedstatehandle]
summary: "Use ViewModel as a screen-level state holder with unidirectional data flow, a pure reducer, SavedStateHandle, and a list of what never belongs in it."
---

A screen with six pieces of mutable state, three of them in the ViewModel, two in the Composable, and one in a Fragment field, will eventually show something that contradicts itself: a spinner next to an error, a list that survived rotation but a query that did not. The fix is not a bigger framework. It is one rule: a screen has a single immutable state object, it flows down, and everything the user does flows up as an action.

## TL;DR

- `ViewModel` is the screen-level state holder: it survives configuration changes, owns the screen's `UiState`, and talks to the data layer.
- Unidirectional data flow (UDF): state flows down to the UI, actions flow up to the `ViewModel`. The UI never mutates state directly.
- An MVI-style reducer is a pure function `(state, message) -> state`. You can write it in 20 lines with `MutableStateFlow.update` and no library.
- `SavedStateHandle` carries small pieces of state across process death. A `ViewModel` alone does not.
- Never keep an `Activity`, `Fragment`, `View`, `NavController` or a UI-scoped `Context` in a `ViewModel`.

## What a ViewModel is for

`ViewModel` gives you two guarantees: its instance survives configuration changes (rotation, locale, window resize), and it is cleared (`onCleared()`, `viewModelScope` cancelled) when its owner is permanently gone. It is scoped to an owner: an `Activity`, a `Fragment`, or a navigation back stack entry. The back-stack-entry scope is usually the right one for a screen.

What it does *not* guarantee is survival of process death. When the system kills your process in the background, the `ViewModel` is gone and is re-created empty on return. Anything the user would be upset to lose has to be either re-derivable from a data source or stored in `SavedStateHandle` (see below).

Its job is to be the screen's state holder: translate data-layer results into UI state and translate UI actions into data-layer calls. Pure business rules belong in domain or repository classes that can be tested without Android at all.

## Unidirectional data flow with a reducer

Define three things per screen: the state, the actions the UI can send, and a reducer.

```kotlin
data class SearchUiState(
    val query: String = "",
    val results: List<Item> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

sealed interface SearchAction {
    data class QueryChanged(val query: String) : SearchAction
    data object RetryClicked : SearchAction
}

// Internal messages describe *what happened*; the reducer decides the new state.
private sealed interface Msg {
    data class QueryEdited(val text: String) : Msg
    data object Loading : Msg
    data class Loaded(val items: List<Item>) : Msg
    data class Failed(val message: String) : Msg
}

private fun reduce(state: SearchUiState, msg: Msg): SearchUiState = when (msg) {
    is Msg.QueryEdited -> state.copy(query = msg.text)
    Msg.Loading -> state.copy(isLoading = true, error = null)
    is Msg.Loaded -> state.copy(isLoading = false, results = msg.items)
    is Msg.Failed -> state.copy(isLoading = false, error = msg.message)
}
```

The reducer is pure: no coroutines, no I/O, no clock. That is the whole point. The impossible combinations (loading and error at once) are ruled out in one place, and a test is a plain function call.

The `ViewModel` is the thin imperative shell around it:

```kotlin
class SearchViewModel(
    private val repository: SearchRepository,
    private val savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _state = MutableStateFlow(
        SearchUiState(query = savedStateHandle[KEY_QUERY] ?: "")
    )
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    init {
        if (_state.value.query.isNotBlank()) search(_state.value.query)
    }

    fun onAction(action: SearchAction) {
        when (action) {
            is SearchAction.QueryChanged -> {
                savedStateHandle[KEY_QUERY] = action.query
                dispatch(Msg.QueryEdited(action.query))
                search(action.query)
            }
            SearchAction.RetryClicked -> search(_state.value.query)
        }
    }

    private fun dispatch(msg: Msg) = _state.update { reduce(it, msg) }

    private fun search(query: String) {
        searchJob?.cancel()                       // latest query wins
        searchJob = viewModelScope.launch {
            dispatch(Msg.Loading)
            try {
                dispatch(Msg.Loaded(repository.search(query)))
            } catch (e: IOException) {
                dispatch(Msg.Failed(e.message ?: "Network error"))
            }
        }
    }
}

private const val KEY_QUERY = "query"
```

Side effects (the repository call) live in `search`; state changes live in `reduce`. `StateFlow.update` makes each transition atomic. The `catch` only catches `IOException`, so a `CancellationException` from `searchJob?.cancel()` passes through untouched.

On the UI side, the route collects state and hands the screen a plain state value plus one callback. The screen itself is stateless, which makes previews and UI tests trivial:

```kotlin
@Composable
fun SearchRoute(viewModel: SearchViewModel = viewModel(factory = SearchViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SearchScreen(state = state, onAction = viewModel::onAction)
}

@Composable
fun SearchScreen(state: SearchUiState, onAction: (SearchAction) -> Unit) {
    // render state; call onAction(...) for every user input
}
```

Is a single `onAction` entry point required? No. A handful of named public functions (`onQueryChanged`, `onRetry`) give the same one-way flow with less ceremony, and for small screens I would pick them. The single sealed `Action` pays off when you want to log, replay or test every input through one door, or when the screen has many inputs.

## SavedStateHandle and the factory

`SavedStateHandle` is a key-value map that the framework saves and restores with the screen's saved instance state. Values must be types a `Bundle` can hold (primitives, `String`, `Parcelable`, `Serializable`, and so on), and they should be small. It also receives navigation arguments, which makes it the standard way to read a route's id in the `ViewModel`.

You can read a value as a flow to keep it observable:

```kotlin
val query: StateFlow<String> = savedStateHandle.getStateFlow(KEY_QUERY, "")
```

Store the *input* that lets you rebuild the screen (the query, the selected id), not the *output* (the result list). Re-fetch or re-read the output after restoration. Large payloads in saved state risk `TransactionTooLargeException`.

A `ViewModel` with extra constructor arguments needs a factory. The built-in `viewModelFactory` DSL does that without boilerplate:

```kotlin
companion object {
    val Factory: ViewModelProvider.Factory = viewModelFactory {
        initializer {
            val app = this[APPLICATION_KEY] as MyApp
            SearchViewModel(
                repository = app.container.searchRepository,
                savedStateHandle = createSavedStateHandle(),
            )
        }
    }
}
```

With Hilt this collapses to `@HiltViewModel` and `hiltViewModel()`, covered in the Hilt guide on this site.

## What must not go in a ViewModel

A `ViewModel` outlives the `Activity` instance it was created for. Anything it holds that points back at the old instance is a leak, and often a crash.

- **`Activity`, `Fragment`, `View`, `NavController`, `LifecycleOwner`.** They die on rotation while the `ViewModel` lives on. Expose state; let the UI navigate.
- **A UI `Context`.** Same leak. If you need resources, return a string resource id or a small sealed `UiText` type and resolve it in the UI. If you truly need an application-level dependency, inject it as a class (a repository, a `ResourceProvider` backed by the application context) rather than passing `Context` around. `AndroidViewModel` exists but is a smell for anything beyond trivial cases.
- **Compose `State` tied to a composition, `SnackbarHostState`, `ScrollState`.** These belong to UI-element state holders that live in the composition.
- **Large objects (bitmaps, big lists) you cannot rebuild.** They are lost on process death anyway.
- **One-off event channels as the primary mechanism.** Model the event as state and consume it; see the StateFlow post.

## Common mistakes

- **Multiple sources of truth for the same screen** (some fields in the `ViewModel`, some `remember`ed in the Composable). Consequence: states drift apart across rotation or restoration. Fix: one `UiState` per screen; keep only purely visual state (scroll position, focus) in the UI.
- **Impure reducers** (calling the repository or reading `System.currentTimeMillis()` inside `reduce`). Consequence: untestable and order-dependent state. Fix: do I/O in the `ViewModel` and pass the result in as a message.
- **Exposing `MutableStateFlow`.** Consequence: the UI can bypass the actions. Fix: private mutable, public `StateFlow`.
- **Storing results in `SavedStateHandle`.** Consequence: `TransactionTooLargeException` or stale data after restore. Fix: save inputs, reload outputs.
- **Assuming the `ViewModel` survives process death.** Consequence: blank or reset screen after the app returns from background. Fix: `SavedStateHandle` plus a data source you can re-read; test it (see the lifecycle post).
- **Cancelling nothing.** Consequence: slow earlier requests overwrite results of the latest query. Fix: keep the `Job`, cancel it, or use `flatMapLatest` over a query flow.

## If you know iOS

The shape is the same as a SwiftUI screen backed by an `@Observable` (or `ObservableObject`) view model: state flows down, user intent calls methods on the model. The `UiState` data class plays the role of a struct of published properties, and the reducer pattern is what you would write for a Redux-like store in Swift. Process-death restoration maps loosely to `@SceneStorage` and scene state restoration. One difference to remember: Android destroys and recreates the Activity on configuration changes, which is why the `ViewModel` exists at all, whereas SwiftUI views are cheap value types re-evaluated from state. See the Equivalents page.

## Further reading

- [UI layer overview and UDF](https://developer.android.com/topic/architecture/ui-layer)
- [State holders and UI state](https://developer.android.com/topic/architecture/ui-layer/stateholders)
- [ViewModel overview](https://developer.android.com/topic/libraries/architecture/viewmodel)
- [Saved State module for ViewModel](https://developer.android.com/topic/libraries/architecture/viewmodel/viewmodel-savedstate)
