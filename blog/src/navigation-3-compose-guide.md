---
title: "Navigation 3 for Compose: a practical guide"
slug: navigation-3-compose-guide
date: 2026-11-02
order: 3
category: "Jetpack Compose"
tags: [compose, navigation, navigation3]
summary: "Navigation 3 in practice: you own the back stack and NavDisplay renders it. Serializable keys, ViewModel scoping, scenes for tablets, and NavHost differences."
---

Navigation 2's `NavHost` asks you to describe a graph, hand control to a `NavController`, and then reach into that controller's hidden back stack whenever you need something it did not anticipate: a bottom bar with separate histories, a login gate, two panes on a tablet. Navigation 3 (`androidx.navigation3`) inverts the model. The back stack is a plain list that you own. You add a key to navigate and remove one to go back, and a composable called `NavDisplay` renders whatever the list says.

## TL;DR

- The back stack is a `NavBackStack` (a list of keys you own). `backStack.add(key)` navigates; `backStack.removeLastOrNull()` goes back. There is no `NavController`.
- Keys are small `@Serializable` types that implement `NavKey`. `rememberNavBackStack` saves them across configuration change and process death.
- `NavDisplay` takes the back stack and an `entryProvider` that maps each key type to composable content.
- Per-screen `ViewModel` scoping is opt-in: add `rememberViewModelStoreNavEntryDecorator()` (alongside the saveable-state decorator) to `entryDecorators`.
- Scenes let `NavDisplay` show more than one back stack entry at once, which is how list-detail and supporting-pane layouts work on large screens.

## Setup

Navigation 3 is split into a runtime and a UI artifact, plus optional add-ons. Add the Kotlin serialization plugin because keys are serialized.

```toml
[libraries]
androidx-navigation3-runtime = { group = "androidx.navigation3", name = "navigation3-runtime", version.ref = "navigation3" }
androidx-navigation3-ui = { group = "androidx.navigation3", name = "navigation3-ui", version.ref = "navigation3" }
androidx-lifecycle-viewmodel-navigation3 = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-navigation3", version.ref = "lifecycle" }
androidx-material3-adaptive-navigation3 = { group = "androidx.compose.material3.adaptive", name = "adaptive-navigation3", version.ref = "adaptive" }
kotlinx-serialization-core = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-core", version.ref = "serialization" }

[plugins]
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

Take the version numbers from the AndroidX release notes for your project; do not copy them from a blog post. The adaptive artifact is only needed for the scenes section below.

## Keys, back stack, and NavDisplay

A destination is identified by a key. Make keys `@Serializable` types that implement `NavKey`. Use `data object` for screens without arguments and `data class` for screens with them. This is type-safe navigation: the arguments are typed properties on the key, and there are no route strings to build or parse.

```kotlin
@Serializable data object Home : NavKey
@Serializable data class ProductList(val categoryId: String) : NavKey
@Serializable data class ProductDetail(val productId: String) : NavKey
```

The back stack and the display are two lines of wiring:

```kotlin
@Composable
fun AppNavigation() {
    val backStack = rememberNavBackStack(Home)

    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        entryProvider = entryProvider {
            entry<Home> {
                HomeScreen(onOpenCategory = { id ->
                    backStack.add(ProductList(id))
                })
            }
            entry<ProductList> { key ->
                ProductListScreen(
                    categoryId = key.categoryId,
                    onOpenProduct = { backStack.add(ProductDetail(it)) },
                )
            }
            entry<ProductDetail> { key ->
                ProductDetailScreen(productId = key.productId)
            }
        },
    )
}
```

The `entryProvider` block with one `entry` call per key class is the DSL form. Each `entry` receives the key instance, so arguments arrive typed. You can also pass a function `(key) -> NavEntry` that uses a `when` on the key, which is the lower-level API the DSL builds on.

Because the back stack is a list, normal Kotlin list operations are your navigation operations:

```kotlin
// Go back
backStack.removeLastOrNull()

// Replace the current screen (no back entry left behind)
backStack[backStack.lastIndex] = ProductDetail(id)

// Pop back to Home but keep Home itself
while (backStack.size > 1) backStack.removeLastOrNull()

// Clear and set a new root, such as after login
backStack.clear()
backStack.add(Home)
```

There is no `popUpTo` or `launchSingleTop` option string, because you do not need one. If you want single-top behavior, check `backStack.lastOrNull() != key` before adding.

When a screen's click handler triggers navigation, wrap it with `dropUnlessResumed` from lifecycle-runtime-compose. It ignores a click that arrives while the screen is already transitioning out, which prevents double navigation on a fast double-tap.

## Scoping ViewModels to entries

By default a `viewModel()` call inside an entry is scoped to the Activity (or whatever `ViewModelStoreOwner` is above `NavDisplay`), so two product detail entries would share one `ViewModel`. To scope it to the entry, add the decorators. When you pass `entryDecorators`, you replace the defaults, so include the saveable-state decorator too:

```kotlin
NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryDecorators = listOf(
        rememberSaveableStateHolderNavEntryDecorator(),
        rememberViewModelStoreNavEntryDecorator(),
    ),
    entryProvider = entryProvider {
        entry<ProductDetail> { key ->
            val vm = viewModel<ProductDetailViewModel>(
                factory = ProductDetailViewModel.factory(key.productId)
            )
            ProductDetailScreen(vm)
        }
    },
)
```

The decorator keys each `ViewModel` on the entry's content key, so every distinct key instance gets its own `ViewModel`, created when the entry is pushed and cleared when it is popped. The official recipes show the same pattern with Hilt assisted injection and with Koin.

## Scenes: more than one entry on screen

A `Scene` is what `NavDisplay` renders for a slice of the back stack. The default scene shows only the top entry. A `SceneStrategy` looks at the back stack and may return a richer scene, for example one that places two entries side by side. Strategies are tried in order; the first non-null result wins; the single-pane default is the fallback.

The Material 3 adaptive library ships strategies for list-detail and supporting-pane layouts. You mark entries with metadata and pass the strategy to `NavDisplay`:

```kotlin
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun AdaptiveNavigation() {
    val backStack = rememberNavBackStack(ConversationList)
    val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>()

    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        sceneStrategies = listOf(listDetailStrategy),
        entryProvider = entryProvider {
            entry<ConversationList>(
                metadata = ListDetailSceneStrategy.listPane(
                    detailPlaceholder = { Text("Choose a conversation") }
                )
            ) {
                ConversationListScreen(onClick = { backStack.add(ConversationDetail(it)) })
            }
            entry<ConversationDetail>(
                metadata = ListDetailSceneStrategy.detailPane()
            ) { key ->
                ConversationDetailScreen(key.id)
            }
        },
    )
}
```

On a compact window the same back stack renders one pane at a time, exactly like a phone app. On a wide window the list and detail share the screen, with the placeholder shown until something is selected. Nothing about your navigation calls changes. When selecting a new detail on a wide window, remove the previous detail key before adding the new one so the stack does not grow with every tap. If you need a layout the library does not provide, write your own `SceneStrategy`; the recipes repository has two-pane and bottom-sheet examples.

## Navigation 2 vs Navigation 3

| Concern | Navigation 2 | Navigation 3 |
|---|---|---|
| Back stack | Owned by `NavController`; read-only view | A list you own and mutate |
| Destinations | Declared in a `NavHost` graph | Keys resolved by `entryProvider` |
| Type-safe args | Serializable route classes passed to `composable` | Serializable key classes passed to `entry` |
| Navigate | `navController.navigate(route)` with options | `backStack.add(key)` |
| Back | `popBackStack()` | `removeLastOrNull()` |
| Multiple back stacks | `saveState` / `restoreState` flags | You model it; the recipes show one stack per tab |
| Multi-pane layouts | Not part of `NavHost` | Scenes and scene strategies |
| Persistence | Handled by `NavController` | `rememberNavBackStack` for serializable keys |

The price of ownership is that behavior Navigation 2 handled implicitly is now your code: how many back stacks a bottom bar has, what happens at the root, how deep links expand into a synthetic back stack. The recipes repository has tested examples of each, and the migration guide covers moving an existing app.

## Common mistakes

- **Forgetting `NavKey` or `@Serializable` on a key.** `rememberNavBackStack` cannot save it, so the app crashes or loses its stack on process death. Fix: every key implements `NavKey` and carries `@Serializable`, and the serialization plugin is applied.
- **Putting heavy objects in keys.** A key is serialized into saved state. Large or non-serializable payloads cause crashes or `TransactionTooLargeException`. Fix: put an ID in the key and load data in the destination's `ViewModel`.
- **Replacing `entryDecorators` without the defaults.** Per-entry saved state silently stops working. Fix: include `rememberSaveableStateHolderNavEntryDecorator()` whenever you add another decorator.
- **Popping the last entry.** `removeLastOrNull()` on a one-item stack leaves `NavDisplay` with nothing to show. Fix: decide the root behavior explicitly, for example finish the Activity from `onBack` when the stack has one entry.
- **Navigating on every click without a guard.** A double tap pushes two entries. Fix: wrap handlers in `dropUnlessResumed`, or check the top of the stack first.
- **Reusing one `ViewModel` for all entries of the same type.** Detail screens show stale data from the previous item. Fix: scope with `rememberViewModelStoreNavEntryDecorator()` and create the `ViewModel` from the key.

## If you know iOS

Navigation 3 resembles SwiftUI's `NavigationStack` with a bound path: you own an array of values, appending pushes, removing pops, and `navigationDestination(for:)` maps each value type to a view, which is what a typed `entry` does. Navigation 3 keys play the role of the `Hashable` path values. Scenes have no direct counterpart in `NavigationStack`; the nearest idea is `NavigationSplitView`, which chooses one or two columns by size class. See the Equivalents page for the full navigation mapping.

## Further reading

- [Navigation 3 overview](https://developer.android.com/guide/navigation/navigation-3)
- [Get started with Navigation 3](https://developer.android.com/guide/navigation/navigation-3/basics)
- [Create custom layouts using Scenes](https://developer.android.com/guide/navigation/navigation-3/custom-layouts)
- [Navigation 3 recipes (GitHub)](https://github.com/android/nav3-recipes)
