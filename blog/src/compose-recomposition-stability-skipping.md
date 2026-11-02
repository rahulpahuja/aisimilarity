---
title: "Compose recomposition, stability and skipping explained"
slug: compose-recomposition-stability-skipping
date: 2026-11-02
order: 2
category: "Jetpack Compose"
tags: [compose, performance, recomposition]
summary: "How recomposition and skipping actually work, what strong skipping changed, when @Stable and @Immutable help, and how to measure instead of guessing."
---

Most Compose performance advice reads like superstition: annotate everything `@Immutable`, wrap lists in `ImmutableList`, hoist every lambda into `remember`. Some of it was necessary before Kotlin 2.0.20. Some of it now makes apps slower. To tune a Compose screen you need a correct mental model of what a recomposition costs, what skipping costs, and which tools tell you the difference.

## TL;DR

- Recomposition re-runs only the composable scopes whose observed state changed or whose inputs changed. A composable can be skipped when all of its inputs compare equal to last time.
- Strong skipping mode, on by default in the Compose compiler that ships with Kotlin 2.0.20 and later, lets composables with unstable parameters skip too, by comparing those parameters with instance equality (`===`).
- Skipping is not free: every parameter is stored and compared on each recomposition. Annotating large models `@Stable` or `@Immutable` switches the comparison from a cheap `===` to `equals()`, which can cost more than the recomposition you avoided.
- The biggest wins come from reading fast-changing state in the Layout or Draw phase instead of Composition, giving lazy list items stable keys, and keeping composables cheap.
- Measure with Layout Inspector recomposition counts, the compiler reports, and a Macrobenchmark on a release build. Recomposition counts alone are not a performance metric.

## What recomposition actually does

Compose runs three phases per frame: Composition (what to show), Layout (where to put it), Drawing (how to render it). When a `State` object that was read during composition changes, Compose invalidates the smallest enclosing recompose scope and re-runs it. Scopes are mostly the bodies of composable functions that return `Unit`; inline functions such as `Column` do not get their own scope.

```kotlin
@Composable
fun Screen(vm: ProfileViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    Header(name = state.name)           // inputs: String
    Stats(count = state.followerCount)  // inputs: Int
}
```

If only `followerCount` changes, `Screen` re-runs (it read `state`), `Header` is skipped because `name` is equal, and `Stats` runs because its input changed. Skipping is the mechanism that keeps the rest of the tree from re-running.

## Stability, and what strong skipping changed

The compiler classifies each parameter type as stable or unstable. A type is stable if Compose can trust that equal instances stay equal and that any public change notifies Compose: primitives, `String`, function types, and classes whose properties are all stable `val`s. Unstable types include classes with a `var` property, classes from modules the compiler did not process, and the standard collection interfaces such as `List`, `Set` and `Map`, because they could be backed by a mutable implementation.

Before strong skipping, a composable with any unstable parameter could not skip at all. That is where the "wrap it in `ImmutableList`" folklore came from.

With strong skipping:

- Composables with unstable parameters are skippable. Unstable parameters are compared with instance equality (`===`), stable ones with `equals()`.
- Lambdas that capture unstable values are automatically remembered, keyed on their captures, so an inline `onClick = { vm.onClick(id) }` does not defeat skipping the way it used to.

This means the common case is already handled:

```kotlin
data class FeedState(
    val feedId: String,
    val items: List<FeedItem>,   // unstable by the compiler's rules, still fine
)

@Composable
fun FeedScreen(state: FeedState, onItemClick: (String) -> Unit) {
    FeedHeader(feedId = state.feedId)
    FeedList(items = state.items, onItemClick = onItemClick)
}
```

`FeedList` skips if the same `List` instance is passed again. It recomposes when the list is a new instance, and in practice that is what you want, because a new instance almost always means new data.

Where it still bites is when you create a new instance on every recomposition without any change in content:

```kotlin
@Composable
fun FeedScreen(state: FeedState) {
    // New list every time FeedScreen runs: FeedList can never skip.
    FeedList(items = state.items.filter { it.isVisible })
}
```

Move the transformation to the `ViewModel`, or wrap it in `remember(state.items) { ... }`.

## When `@Stable` and `@Immutable` help, and when they hurt

An annotation is a promise to the compiler, and it changes the comparison from `===` to `equals()`. That is a trade, not a free upgrade.

- Use it on small, flat models whose `equals()` is cheap and that are re-created with identical content on each emission (for example, mapping a database row to a UI model on every query). Also use it for types from modules that are not compiled with the Compose compiler, where the compiler cannot infer stability.
- Do not use it on models that hold large or nested collections. A deep `equals()` on hundreds of items runs on every recomposition pass, and traces often show `equals` costing more than the composable body.
- Do not replace `List` with `ImmutableList` to "fix" stability under strong skipping. It forces element-by-element comparison where a pointer check would do, and when a parent compares a data class holding the list and a child compares the unwrapped list, you pay twice.
- Do not add annotations to flat data classes of primitives and strings in a Compose module. They are already inferred stable.

If you need a type from a library to count as stable, a stability configuration file lets you declare it without touching the library's source. Check the stability documentation for the file format and Gradle property for your Compose compiler version.

## Make composables cheaper instead of chasing skips

Once a recomposition pass has started, skipping one more composable in it saves little. The expensive part is scheduling the pass. So the highest-value fix is often to avoid the pass entirely by reading fast-changing state later.

```kotlin
// Recomposes on every scroll pixel: state is read during Composition.
Box(Modifier.offset(x = scrollState.value.dp))

// Reads the state in the Layout phase. Composition is skipped.
Box(Modifier.offset { IntOffset(scrollState.value, 0) })

// Alpha animation read in the Draw phase.
val alpha by animateFloatAsState(if (visible) 1f else 0f)
Box(Modifier.graphicsLayer { this.alpha = alpha })
```

For derived flags driven by fast-changing state, avoid reading the raw value in composition:

```kotlin
val showButton by remember {
    derivedStateOf { listState.firstVisibleItemIndex > 0 }
}
```

Do not pass the state value as a `remember` key around `derivedStateOf`; that recreates it on every change and defeats it. Newer Compose releases may offer cheaper alternatives for simple conditions, so check the release notes for your version.

## Lazy lists: keys and content types

In `LazyColumn`, `LazyRow` and grids, give every item a stable key and a content type:

```kotlin
LazyColumn {
    items(
        items = messages,
        key = { it.id },
        contentType = { it.kind },
    ) { message ->
        MessageRow(message)
    }
}
```

The `key` lets Compose keep item state and animations attached to the right item when the list is reordered or items are inserted; without it, state follows the position. The key must be saveable in a `Bundle`, so use an `Int`, `Long`, or `String`, never an index or a non-parcelable class. `contentType` lets Compose reuse the composition of one row for another of the same kind while scrolling.

Also keep the following out of item bodies: `indexOf` lookups (use `itemsIndexed`), per-item `collectAsStateWithLifecycle()` on a shared flow (collect once above the list), and `LaunchedEffect` for impression logging (items are composed before they are visible; use `Modifier.onVisibilityChanged`). For lists of ten or fewer items, a plain `Column` or `Row` with a loop is usually cheaper than a lazy container.

## How to measure

### Layout Inspector

Run a debuggable build, open Layout Inspector in Android Studio, and enable recomposition counts for the Compose tree. You see, per node, how many times it recomposed and how many times it was skipped while you interact with the app. Use it to find nodes that recompose when you did not expect them to.
### Compiler reports

Ask the Compose compiler plugin to write stability and skippability reports:

```kotlin
composeCompiler {
    reportsDestination = layout.buildDirectory.dir("compose_compiler")
    metricsDestination = layout.buildDirectory.dir("compose_compiler")
}
```

Build a release variant, then read the `*-classes.txt` files (which classes are stable or unstable) and `*-composables.txt` (which composables are restartable and skippable). Look for unexpected unstable parameters in hot composables.

### Benchmarks

Layout Inspector counts and compiler reports tell you what happens, not whether it matters. Measure frame timing with Macrobenchmark on a release build with R8 and a baseline profile. Never judge performance on a debuggable build.

## Common mistakes

- **Annotating everything `@Immutable`.** Consequence: `equals()` on large models runs on every pass and can slow scrolling. Fix: remove the annotation from models feeding lazy layouts with large data, and rely on `===`.
- **Treating recomposition counts as a goal.** Consequence: you add `remember` and wrappers to save microseconds. Fix: look for the composition you can avoid by deferring reads, then benchmark.
- **Creating new collections or objects in the composable body.** Consequence: children never skip because the instance changes every time. Fix: compute in the `ViewModel` or use `remember` with the right keys.
- **Reading animated or scroll state at the top of a big composable.** Consequence: the whole subtree recomposes per frame. Fix: use lambda modifiers (`offset { }`, `graphicsLayer { }`) or pass `() -> Float` providers to leaf composables.
- **Omitting `key` in lazy lists.** Consequence: item state jumps between rows after inserts or reorders, and animations break. Fix: key by a stable unique ID.
- **Profiling a debug build.** Consequence: numbers are far worse than production and point at the wrong things. Fix: use a release-like build for any measurement.

## If you know iOS

SwiftUI's `body` re-evaluation and view diffing play the role of recomposition and skipping. In SwiftUI, `@Observable` tracks which properties a view reads, so only views that read a changed property re-evaluate; Compose gets a similar granularity from reading `State` in a specific scope. The `Equatable` conformance trick for SwiftUI views is the rough cousin of Compose stability: both are ways to tell the framework when inputs did not meaningfully change. The Instruments SwiftUI template is the analog to Layout Inspector's recomposition counts. See the Equivalents page for the broader mapping.

## Further reading

- [Stability in Compose](https://developer.android.com/develop/ui/compose/performance/stability)
- [Strong skipping mode](https://developer.android.com/develop/ui/compose/performance/stability/strongskipping)
- [Diagnose stability issues](https://developer.android.com/develop/ui/compose/performance/stability/diagnose)
- [Follow best practices for Compose performance](https://developer.android.com/develop/ui/compose/performance/bestpractices)
