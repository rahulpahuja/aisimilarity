---
title: "Edge-to-Edge on Android 15: Insets in Compose and Views"
slug: edge-to-edge-android-15-compose
date: 2026-11-02
order: 16
category: "Platform & Performance"
tags: [edge-to-edge, insets, compose, android-15, ime]
summary: "Android 15 draws apps behind the system bars when targetSdk is 35. How enableEdgeToEdge, WindowInsets, IME insets and bar contrast work in Compose and Views."
---

You bump `targetSdk` to 35, run the app on an Android 15 device, and the toolbar sits under the status bar, the bottom button is under the gesture handle, and the last list item is unreachable. Nothing in your code changed. The platform now draws your window behind the system bars, and it is your job to decide where content goes.

## TL;DR

- Apps targeting API 35 are edge-to-edge by default on Android 15 devices. Call `enableEdgeToEdge()` before `setContent` on every Activity so older versions behave the same way.
- In Compose, let `Scaffold` and the Material 3 bars handle insets, pass `innerPadding` to scrollable content as `contentPadding`, and use `safeDrawingPadding()` only outside a Scaffold.
- Apply each inset exactly once. Double padding (usually from IME insets) is the most common bug after the initial "everything is covered" one.
- `windowOptOutEdgeToEdgeEnforcement` only buys time on Android 15. It is disabled for apps targeting API 36.
- Status and navigation bar colour attributes no longer do what they used to. Draw the colour yourself, and use `SystemBarStyle` for icon contrast.

## What actually changed in Android 15

Per the Android 15 behavior changes, apps that target API 35 are edge-to-edge by default on Android 15 devices. The concrete defaults:

- The status bar is transparent.
- With gesture navigation, the navigation bar is transparent and content draws behind it.
- With three-button navigation, the system adds a translucent background (80% opacity by default) unless you turn that off.
- `setStatusBarColor` and `setNavigationBarColor` (and the matching theme attributes) are deprecated and do not control the gesture bar. `statusBarColor` has no effect on Android 15.
- Display cutouts: `layoutInDisplayCutoutMode` values `SHORT_EDGES`, `NEVER` and `DEFAULT` are treated as `ALWAYS`, so no black bar appears next to a cutout.

There was a temporary escape hatch: set `android:windowOptOutEdgeToEdgeEnforcement` to `true` in a theme under `values-v35`. The Android 16 behavior changes say that attribute is deprecated and disabled for apps targeting API 36, so treat it as a short delay, not a fix.

```xml
<!-- res/values-v35/themes.xml: temporary, Android 15 only -->
<style name="Theme.MyApp" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>
</style>
```

## Opt in explicitly with enableEdgeToEdge

Do not rely on the enforcement alone. Call `enableEdgeToEdge()` from `androidx.activity` so Android 14 and below get the same layout and the bar icon colours are handled for you.

```kotlin
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge() // before setContent
        setContent {
            AppTheme { AppScreen() }
        }
    }
}
```

By default it uses `SystemBarStyle.auto`, which follows the system dark theme. If your app has its own light/dark switch that is independent of the system, pass the style yourself, otherwise you get dark icons on a dark surface:

```kotlin
val dark = appSettings.isDarkTheme
enableEdgeToEdge(
    statusBarStyle = if (dark) SystemBarStyle.dark(Color.TRANSPARENT)
                     else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    navigationBarStyle = if (dark) SystemBarStyle.dark(Color.TRANSPARENT)
                         else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
)
```

Here `Color` is `android.graphics.Color`, because `SystemBarStyle` takes `Int` ARGB values. Re-call `enableEdgeToEdge` when the in-app theme changes. Only use the `WindowCompat` insets-controller route (`isAppearanceLightStatusBars`) if you are not using `enableEdgeToEdge` from `ComponentActivity`; the two should not fight.

## Insets in Compose

The rule of thumb: pick one mechanism per region of the screen.

1. **Use `Scaffold`.** Material 3 `TopAppBar`, `BottomAppBar`, `NavigationBar`, `NavigationRail`, `ModalBottomSheet` and the drawer sheets apply their own insets. `Scaffold` hands you `innerPadding` for everything else.
2. **Give scrollable content `contentPadding`, not `Modifier.padding`.** Padding the container clips the list; `contentPadding` lets items scroll behind the bars while the first and last item can still be reached.
3. **Outside a Scaffold, use `safeDrawingPadding()`** or `windowInsetsPadding(WindowInsets.safeDrawing)`.

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(items: List<String>) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Feed") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { /* add */ }) {
                Icon(Icons.Default.Add, contentDescription = "Add")
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .consumeWindowInsets(innerPadding),
            contentPadding = innerPadding
        ) {
            items(items) { ListItem(headlineContent = { Text(it) }) }
        }
    }
}
```

`consumeWindowInsets(innerPadding)` tells descendants that these insets are already handled, which stops a nested component from adding them again.

Adaptive scaffolds such as `NavigationSuiteScaffold` and `ListDetailPaneScaffold` do not pass `PaddingValues` to their content. Apply insets to each screen's list `contentPadding` or FAB. Do not wrap the whole adaptive scaffold in `safeDrawingPadding()`; that clips the edge-to-edge drawing you just enabled.

For a custom header or scrim that must match a system bar's size, use the size modifiers, for example `Modifier.windowInsetsTopHeight(WindowInsets.statusBars)`.

### The keyboard

Add `android:windowSoftInputMode="adjustResize"` to Activities that show a soft keyboard (the manifest attribute, not the deprecated `SOFT_INPUT_ADJUST_RESIZE` window flag). Then make sure the IME insets reach your layout exactly once.

`Scaffold`'s default `contentWindowInsets` does not include the IME. Two correct patterns:

```kotlin
// Option A: Scaffold owns the IME insets
Scaffold(contentWindowInsets = WindowInsets.safeDrawing) { innerPadding ->
    Column(
        Modifier
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)
            .verticalScroll(rememberScrollState())
    ) { /* TextFields */ }
}

// Option B: default Scaffold, content owns the IME insets
Scaffold { innerPadding ->
    Column(
        Modifier
            .padding(innerPadding)
            .consumeWindowInsets(innerPadding)
            .imePadding() // before verticalScroll
            .verticalScroll(rememberScrollState())
    ) { /* TextFields */ }
}
```

Option A plus `imePadding()` is the double-padding bug: the keyboard opens and the form jumps up by twice its height. Recent Compose foundation also offers `Modifier.fitInside(WindowInsetsRulers.Ime.current)`, which fits content to the IME without the consumption bookkeeping; the Android guidance prefers it, but check your Compose BOM's release notes before adopting it.

## Insets in Views

For View-based screens, use `ViewCompat.setOnApplyWindowInsetsListener` and apply only the sides you need. Keep the original padding so a second pass does not stack.

```kotlin
val bottomPadding = binding.list.paddingBottom
ViewCompat.setOnApplyWindowInsetsListener(binding.list) { v, windowInsets ->
    val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
    )
    v.updatePadding(bottom = bottomPadding + bars.bottom)
    windowInsets
}
```

```xml
<androidx.recyclerview.widget.RecyclerView
    android:id="@+id/list"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:clipToPadding="false" />
```

`clipToPadding="false"` is the View equivalent of `contentPadding`: content scrolls under the bars but rests clear of them. Material Components bars such as `AppBarLayout` can handle their own insets; check each widget before adding a listener on top.

## System bar contrast

With a bottom bar that should extend to the screen edge, the translucent three-button scrim looks like a stripe. On API 29 and above you can disable the contrast enforcement from the Activity:

```kotlin
if (Build.VERSION.SDK_INT >= 29) {
    window.isNavigationBarContrastEnforced = false
}
```

If instead you have scrolling content under a transparent status bar and the icons become unreadable, draw a gradient scrim above your content, sized with `WindowInsets.statusBars`, rather than reaching for the deprecated colour setters.

## Common mistakes

- **Padding the list container instead of `contentPadding`.** The list clips at the bars and does not scroll underneath them. Pass insets as `contentPadding` (or `clipToPadding="false"` in Views).
- **Using `imePadding()` under a Scaffold that already has `contentWindowInsets = WindowInsets.safeDrawing`.** The IME is applied twice and the layout jumps. Pick one owner of the IME insets.
- **Putting `imePadding()` after `verticalScroll`.** It must come before, or the padding scrolls with the content.
- **Applying `safeDrawingPadding()` to the whole `NavigationSuiteScaffold`.** It clips the bars' backgrounds and defeats edge-to-edge. Apply insets per screen.
- **Still setting `statusBarColor` or `navigationBarColor`.** On Android 15 they have no effect on the status bar or gesture bar. Draw a background behind the bar instead.
- **Forgetting full-screen dialogs.** A `Dialog` with `usePlatformDefaultWidth = false` and `fillMaxSize()` needs `decorFitsSystemWindows = false` in `DialogProperties` to draw behind the bars.
- **Relying on the opt-out.** It stops working when you raise `targetSdk` to 36. Fix the layout now.

## If you know iOS

This is the Android version of the safe area. `WindowInsets.safeDrawing` and `Modifier.safeDrawingPadding()` play the role of `safeAreaInsets` and `.safeAreaPadding()`, and iOS content has also been able to extend under the status bar and home indicator for years. The Android difference is that there are several inset types (status bars, navigation bars, display cutout, IME) that you combine and must consume deliberately, whereas SwiftUI mostly insets for you unless you call `.ignoresSafeArea()`. See the Equivalents page for the full mapping.

## Further reading

- [Edge-to-edge in Views and Compose](https://developer.android.com/develop/ui/views/layout/edge-to-edge)
- [Window insets in Compose](https://developer.android.com/develop/ui/compose/layouts/insets)
- [Android 15 behavior changes: apps targeting API 35](https://developer.android.com/about/versions/15/behavior-changes-15)
- [Android 16 behavior changes: edge-to-edge opt-out going away](https://developer.android.com/about/versions/16/behavior-changes-16)
