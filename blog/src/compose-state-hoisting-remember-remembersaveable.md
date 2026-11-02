---
title: "Compose state hoisting: remember vs rememberSaveable"
slug: compose-state-hoisting-remember-remembersaveable
date: 2026-11-02
order: 1
category: "Jetpack Compose"
tags: [compose, state, viewmodel]
summary: "Where Compose state should live: UI element vs screen state, remember vs rememberSaveable, and how to write stateless composables."
---

A search field loses its text when the user rotates the phone. A "selected tab" resets after process death. A checkbox inside a list item toggles but the parent screen never finds out. All three bugs have the same root cause: state lives in the wrong place, or it lives in the right place with the wrong lifespan. Compose gives you three tools for this (`remember`, `rememberSaveable`, and a state holder such as a `ViewModel`), and the decision between them is mostly about two questions: who needs to read or write this value, and how long must it survive?

## TL;DR

- `remember` survives recomposition only. It is lost on configuration change and process death.
- `rememberSaveable` survives configuration change and process death, but only for data that fits in a `Bundle` (or has a `Saver`).
- Hoist state to the lowest common ancestor that needs to read or write it. Everything below that point should be stateless: it takes a value and an event callback.
- Put UI element state (scroll position, text being typed, expanded or collapsed) in the composable tree. Put screen state (what to show, derived from data and business rules) in a `ViewModel`.
- A `ViewModel` survives configuration change but not process death. Anything the user would be annoyed to lose after process death needs `SavedStateHandle` or `rememberSaveable`.

## The three lifespans

Compose state has three lifespans, and each has a different tool.

| Tool | Survives recomposition | Survives configuration change | Survives process death |
|---|---|---|---|
| `remember` | Yes | No | No |
| `rememberSaveable` | Yes | Yes | Yes (if saveable) |
| `ViewModel` | Yes | Yes | No (unless `SavedStateHandle`) |

Rotating the device, changing the system font size, or toggling dark mode recreates the Activity by default. A plain `remember` holder is discarded with it. This is the right behavior for cheap, derived or purely visual values, and the wrong behavior for anything the user typed or selected.

```kotlin
@Composable
fun SearchBar() {
    // Lost on rotation:
    var queryLost by remember { mutableStateOf("") }

    // Kept across rotation and process death:
    var query by rememberSaveable { mutableStateOf("") }

    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        label = { Text("Search") },
    )
}
```

`rememberSaveable` works out of the box for primitives, `String`, and anything `Parcelable` or `Serializable`. For other types, provide a `Saver`. When the block returns a `MutableState` and you delegate with `by`, pass the saver through the `stateSaver` parameter rather than `saver`:

```kotlin
data class Filter(val tags: Set<String>)

private val FilterSaver = Saver<Filter, List<String>>(
    save = { it.tags.toList() },
    restore = { Filter(it.toSet()) },
)

@Composable
fun FilterBar() {
    var filter by rememberSaveable(stateSaver = FilterSaver) {
        mutableStateOf(Filter(emptySet()))
    }
    // ...
}
```

Do not reach for `android:configChanges` in the manifest to dodge this. It hides state-loss bugs rather than fixing them, and it does nothing for process death.

## Hoisting: make the composable stateless

State hoisting means moving state out of a composable into its caller, and replacing it with two parameters: the current value, and a callback to request a change. The composable becomes a pure function of its inputs, which makes it previewable, testable, and reusable.

```kotlin
// Stateful: owns its own state. Convenient, but hard to reuse and test.
@Composable
fun Counter() {
    var count by rememberSaveable { mutableIntStateOf(0) }
    Button(onClick = { count++ }) { Text("Clicked $count") }
}

// Stateless: value down, events up.
@Composable
fun Counter(count: Int, onIncrement: () -> Unit, modifier: Modifier = Modifier) {
    Button(onClick = onIncrement, modifier = modifier) { Text("Clicked $count") }
}
```

This is the "state down, events up" pattern, also called unidirectional data flow. A useful rule from the official guidance: hoist state to at least the lowest common parent of every composable that reads it, and at most to the highest level where it is written. Hoisting higher than that just forces unrelated recompositions and bloats parameter lists.

A common convenience is to offer both. The public overload is stateless; a thin wrapper owns the state for callers that do not care:

```kotlin
@Composable
fun ExpandableCard(
    title: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) { /* ... */ }

@Composable
fun ExpandableCard(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    ExpandableCard(title, expanded, { expanded = it }, modifier, content)
}
```

Material components follow this convention: `TextField(value, onValueChange)`, `Checkbox(checked, onCheckedChange)`, `Switch(checked, onCheckedChange)`.

## UI element state vs screen state

Not all state belongs in a `ViewModel`. Split by what the state describes.

UI element state is bound to the presentation: whether a dropdown is open, the scroll offset, the text in a field before validation, a `SnackbarHostState`. It is cheap, tied to the composition, and often needs Compose APIs (`LazyListState`, `FocusRequester`). Keep it in the composable tree with `remember` or `rememberSaveable`, or in a plain state holder class that you create with a `rememberXState` function.

Screen state is what the screen shows, derived from data and business rules: the list of loaded items, a loading or error status, whether the Save button is enabled according to domain validation. It usually outlives a single composition, comes from a repository, and benefits from being testable without Compose. Keep it in a `ViewModel` and expose one immutable `StateFlow`.

```kotlin
data class InboxUiState(
    val messages: List<Message> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

class InboxViewModel(private val repo: MessageRepository) : ViewModel() {
    val uiState: StateFlow<InboxUiState> = repo.messages
        .map { InboxUiState(messages = it, isLoading = false) }
        .catch { emit(InboxUiState(isLoading = false, error = it.message)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), InboxUiState())

    fun onMessageDeleted(id: String) { viewModelScope.launch { repo.delete(id) } }
}

@Composable
fun InboxRoute(viewModel: InboxViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    InboxScreen(state = state, onDelete = viewModel::onMessageDeleted)
}

@Composable
fun InboxScreen(
    state: InboxUiState,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState() // UI element state, saved by default
    // ...
}
```

The split into `InboxRoute` (wires the `ViewModel`) and `InboxScreen` (pure, takes state and callbacks) is worth the extra function. Previews and screenshot tests call `InboxScreen` directly with fake state, and no `ViewModel` is ever constructed in a preview.

Use `collectAsStateWithLifecycle()` from `androidx.lifecycle:lifecycle-runtime-compose` in UI code on Android, so collection stops when the screen is not at least STARTED.

## Process death and `SavedStateHandle`

A `ViewModel` survives rotation, but the system can kill your process while the app is in the background. When the user returns, the Activity is recreated and a fresh `ViewModel` is built. State that only lived in the `ViewModel` is gone. For small, user-entered values that matter (a draft, a selected filter, a search query), keep them in `SavedStateHandle`:

```kotlin
class SearchViewModel(private val savedState: SavedStateHandle) : ViewModel() {
    val query: StateFlow<String> = savedState.getStateFlow("query", "")

    fun onQueryChange(value: String) {
        savedState["query"] = value
    }
}
```

Do not push large objects here: the saved state shares a limited transaction buffer. Save identifiers and small inputs, then reload the data from your repository.

## Common mistakes

- **Using `remember` for user input.** The text disappears on rotation. Use `rememberSaveable`, or keep it in a `ViewModel` backed by `SavedStateHandle`.
- **Hoisting everything into the `ViewModel`.** Scroll position, focus, and "is this menu open" become `ViewModel` fields that need to be reset by hand and make the `ViewModel` depend on UI concerns. Keep UI element state in the composable layer.
- **Passing a `MutableState` or `ViewModel` down the tree.** Children that receive a `MutableState` can write to it from anywhere, and children that receive a `ViewModel` cannot be previewed. Pass plain values and lambdas.
- **Forgetting keys.** `remember { expensive(id) }` caches the result for the first `id` forever. Use `remember(id) { expensive(id) }`, and `rememberSaveable(id)` for saved input that is scoped to an item.
- **Saving non-saveable types.** `rememberSaveable { mutableStateOf(MyClass()) }` compiles but throws at save time if `MyClass` cannot go in a `Bundle`. Add a `Saver`, make the class `Parcelable`, or store an identifier instead.
- **Exposing a mutable collection as state.** Mutating an `ArrayList` inside `mutableStateOf` does not notify Compose. Use `mutableStateListOf`, or assign a new immutable list.

## If you know iOS

`remember` maps closely to SwiftUI's `@State`: local, view-owned, and preserved while the view's identity is stable. `@Binding` is the counterpart of passing a value plus a change callback, which is state hoisting by another name. `rememberSaveable` has no exact analog; the nearest SwiftUI idea is `@SceneStorage`, which restores small values across scene recreation. A Compose `ViewModel` exposing `StateFlow` plays the role of an `@Observable` class held by `@State` or injected through the environment. See the Equivalents page for the full mapping.

## Further reading

- [State and Jetpack Compose](https://developer.android.com/develop/ui/compose/state)
- [Where to hoist state](https://developer.android.com/develop/ui/compose/state-hoisting)
- [Save UI state in Compose](https://developer.android.com/develop/ui/compose/state-saving)
- [State holders and UI state](https://developer.android.com/topic/architecture/ui-layer/stateholders)
