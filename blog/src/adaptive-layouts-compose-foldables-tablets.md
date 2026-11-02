---
title: "Adaptive Compose layouts for tablets, foldables and resizable windows"
slug: adaptive-layouts-compose-foldables-tablets
date: 2026-11-02
order: 5
category: "Jetpack Compose"
tags: [compose, adaptive, foldables, tablets]
summary: "Adaptive Compose UIs for phones, tablets and foldables: size classes, NavigationSuiteScaffold, list-detail scenes, adaptive grids, and state across resizing."
---

A phone-only layout stretched across a tablet looks broken: a single column of content 1000 dp wide, a bottom bar the thumb cannot reach, and a detail screen that fills the display when a list could sit beside it. The harder problem is that the window is no longer a fixed size. A foldable changes size when unfolded, a tablet user drags the app into split screen, and a desktop window can be resized at will, and every one of these recreates or resizes your UI while the user is mid-task. Adaptive design in Compose is about reacting to the window you actually have, and keeping state intact while it changes.

## TL;DR

- Branch on the window size class (compact, medium, expanded), not on device type or orientation.
- Use `NavigationSuiteScaffold` for top-level navigation: it shows a navigation bar on compact windows and a rail on larger ones.
- Use Navigation 3 scenes for list-detail and supporting-pane layouts, so one back stack renders as one pane on phones and two on tablets.
- Replace fixed column counts with `GridCells.Adaptive(minSize)`.
- Preserve state across resizing and configuration change with `rememberSaveable`, `rememberLazyListState()` and `ViewModel`. Do not use `android:configChanges` or locked orientation to avoid recreation.

## Window size classes

Window size classes are three width buckets (and three height buckets) with fixed breakpoints:

| Width class | Range | Typical device |
|---|---|---|
| Compact | under 600 dp | Phone in portrait |
| Medium | 600 dp to under 840 dp | Small tablet, unfolded foldable |
| Expanded | 840 dp and up | Tablet, large foldable, desktop window |

Newer window library releases add larger breakpoints for very wide windows; check the release notes for the version you use. The key point is that the class describes the window the app has been given, not the screen. A tablet running your app in split screen is in a compact window, and your layout should treat it as one.

Read the size class from the Material 3 adaptive library:

```kotlin
@Composable
fun HomeScreen(items: List<Item>) {
    val windowSizeClass = currentWindowAdaptiveInfoV2().windowSizeClass

    val columns = when {
        windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) -> 3
        windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) -> 2
        else -> 1
    }
    // ...
}
```

Use the size class for structural decisions (how many panes, which navigation component). For continuous sizing, such as card width or column count in a grid, prefer layouts that measure themselves, as shown below. Newer Compose releases also add an experimental `mediaQuery` API that exposes window size, posture, pointer precision and keyboard type; it is marked experimental and may change, so treat it as something to evaluate, not to build on blindly.

## Adaptive navigation with NavigationSuiteScaffold

Bottom bars suit one-handed phone use. On wider windows the same destinations belong on a rail at the edge of the screen. `NavigationSuiteScaffold` (artifact `androidx.compose.material3:material3-adaptive-navigation-suite`) picks the component from the window's adaptive info, so you declare the destinations once.

```kotlin
enum class TopLevel(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Default.Home),
    Search("Search", Icons.Default.Search),
    Library("Library", Icons.Default.Star),
}

@Composable
fun AppShell() {
    var current by rememberSaveable { mutableStateOf(TopLevel.Home) }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            TopLevel.entries.forEach { destination ->
                item(
                    selected = destination == current,
                    onClick = { current = destination },
                    icon = { Icon(destination.icon, contentDescription = null) },
                    label = { Text(destination.label) },
                )
            }
        },
    ) {
        when (current) {
            TopLevel.Home -> HomeScreen()
            TopLevel.Search -> SearchScreen()
            TopLevel.Library -> LibraryScreen()
        }
    }
}
```

The selected destination is held with `rememberSaveable`, so it survives rotation and fold changes. If a screen hides the navigation area, for example during full-screen media, keep that behavior by hoisting a `NavigationSuiteScaffoldState` with `rememberNavigationSuiteScaffoldState()` and calling `show()` or `hide()` from a `LaunchedEffect`. On a large window the same screen should not hide the rail unnecessarily, so condition the hiding on window size too. Newer releases of the library may offer alternative overloads for supplying items; check the release notes for your version.

## List-detail with Navigation 3 scenes

On a phone, a list screen leads to a detail screen. On a tablet the two should sit side by side. If you use Navigation 3, express this with a scene strategy rather than a separate layout component, so the back stack is the single source of truth. The strategy comes from `androidx.compose.material3.adaptive:adaptive-navigation3`:

```kotlin
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun EmailNavigation() {
    val backStack = rememberNavBackStack(Inbox)
    val strategy = rememberListDetailSceneStrategy<NavKey>()

    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        sceneStrategies = listOf(strategy),
        entryProvider = entryProvider {
            entry<Inbox>(
                metadata = ListDetailSceneStrategy.listPane(
                    detailPlaceholder = { Text("Select a message") }
                )
            ) {
                InboxScreen(onOpen = { id ->
                    backStack.removeIf { it is Message }
                    backStack.add(Message(id))
                })
            }
            entry<Message>(metadata = ListDetailSceneStrategy.detailPane()) { key ->
                MessageScreen(id = key.id)
            }
        },
    )
}
```

Two details matter. When the detail is shown beside the list, it must not draw its own back arrow, because there is nothing to go back to: the list is already visible. And a detail that is full-screen on phones, such as an immersive image, should drop its full-screen mode when it is a pane. Avoid list-detail for content that needs the whole screen to be useful. The Navigation 3 post on this site covers scenes in more depth.

## Adaptive grids

Fixed column counts either leave phones cramped or leave tablets sparse. Give each cell a minimum width and let the grid compute the count:

```kotlin
LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = 160.dp),
    contentPadding = PaddingValues(16.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
) {
    items(items, key = { it.id }, contentType = { "card" }) { item ->
        ItemCard(item)
    }
}
```

The same idea applies to `LazyVerticalStaggeredGrid` with `StaggeredGridCells.Adaptive`. For text-heavy screens, also constrain the reading width (for example `Modifier.widthIn(max = 640.dp)`) so lines do not stretch across a desktop-sized window.

## Preserve state across resizing and configuration changes

Resizing a window, folding a device, rotating, or switching dark mode can recreate the Activity. Compose gives you the tools to survive that; the work is using the right one everywhere.

- Replace `remember { mutableStateOf(...) }` with `rememberSaveable` for anything the user typed or selected.
- Use the saveable factories for scroll state: `rememberLazyListState()`, `rememberLazyGridState()`, `rememberScrollState()`. A plain `remember { LazyListState() }` bypasses the state's `Saver` and loses scroll position on recreation.
- Key saved state on the item it belongs to: `rememberSaveable(conversationId) { mutableStateOf("") }` gives each conversation its own draft.
- Keep screen state in a `ViewModel`, which survives configuration change. Use `SavedStateHandle` for small values that must also survive process death.
- Keep navigation state in a saveable back stack (`rememberNavBackStack`) so the user returns to the same screen after folding.

```kotlin
@Composable
fun ChatScreen(conversationId: String, messages: List<Message>) {
    val listState = rememberLazyListState()
    var draft by rememberSaveable(conversationId) { mutableStateOf("") }

    Column {
        LazyColumn(state = listState, modifier = Modifier.weight(1f)) {
            items(messages, key = { it.id }) { MessageBubble(it) }
        }
        TextField(value = draft, onValueChange = { draft = it })
    }
}
```

Players need special care. An `ExoPlayer` created with `remember` is released and rebuilt on recreation, so playback restarts at zero. Save `currentPosition` and `playWhenReady` in `rememberSaveable`, update them from a `Player.Listener` rather than only on dispose, and restore them before calling `prepare()`.

## Foldables

A foldable adds posture to size. When the device is half-open on a table (tabletop posture), media, camera and video-call UIs work best with content on the upper half and controls on the lower half. Window Manager exposes fold state and hinge position, and the adaptive library surfaces posture through its adaptive info. Treat folding as a resize that can happen at any moment: if your state is saved correctly, the rest is layout. Test unfold and fold with the foldable emulator profiles, not only on a phone.

## Test across form factors

Add one preview annotation that covers the shapes you support, and use it in screenshot tests so regressions show up in review:

```kotlin
@Preview(name = "Phone", device = Devices.PHONE)
@Preview(name = "Foldable", device = Devices.FOLDABLE)
@Preview(name = "Tablet", device = Devices.TABLET)
@Preview(name = "Desktop", device = Devices.DESKTOP)
annotation class FormFactorPreviews
```

Also run the app in the resizable emulator and drag the window across breakpoints while a text field has focus and a list is scrolled. If anything resets, it is state in the wrong place.

## Common mistakes

- **Branching on device type or orientation.** Consequence: split-screen and resizable windows get the wrong layout. Fix: branch on window size class.
- **Locking orientation or declaring `android:configChanges`.** Consequence: you hide state-loss bugs, break resource reloading, and still lose state on process death. Fix: support recreation and fix the state.
- **Plain `remember` for scroll and text state.** Consequence: scroll position and drafts reset on fold or rotate. Fix: `rememberSaveable` and the `rememberLazyListState()` family.
- **Showing a back arrow in a two-pane detail.** Consequence: a button that does nothing useful. Fix: hide it when the detail is displayed as a pane.
- **Fixed column counts and unbounded text width.** Consequence: oversized cards and 200-character lines on large windows. Fix: `GridCells.Adaptive` and a maximum content width.
- **Testing only on a phone.** Consequence: tablet and fold regressions reach users. Fix: form-factor previews, screenshot tests, and a resizable emulator.

## If you know iOS

SwiftUI's size classes (`horizontalSizeClass` and `verticalSizeClass`, compact and regular) are the counterpart of window size classes, and they likewise describe the window rather than the device, which is how iPad multitasking works. `NavigationSplitView` corresponds to a list-detail scene, collapsing to a stack on compact widths. `TabView` adopting a sidebar on iPad is the same idea as `NavigationSuiteScaffold` swapping bar for rail. `@SceneStorage` and `@State` are the closest analogs for keeping view state across scene recreation. See the Equivalents page for the full mapping.

## Further reading

- [Adaptive layouts in Compose](https://developer.android.com/develop/ui/compose/layouts/adaptive)
- [Use window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
- [Build adaptive navigation](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation)
- [Learn about foldables](https://developer.android.com/develop/ui/compose/layouts/adaptive/foldables/learn-about-foldables)
