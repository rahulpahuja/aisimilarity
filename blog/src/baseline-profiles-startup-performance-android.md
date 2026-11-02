---
title: "Android Startup Performance: Baseline Profiles and App Startup"
slug: baseline-profiles-startup-performance-android
date: 2026-11-02
order: 20
category: "Platform & Performance"
tags: [startup, baseline-profiles, macrobenchmark, app-startup, performance]
summary: "Cold, warm and hot starts, how to measure them with Macrobenchmark, and how Baseline Profiles, Startup Profiles and the App Startup library cut cold-start time."
---

Slow startup is rarely one big mistake. It is a long tail of class loading, interpreted code, content providers, SDK initializers and first-frame work, all competing before the user sees anything. You can guess at which part matters, or you can measure it, fix the largest piece, and measure again. This post is the second approach.

## TL;DR

- There are three start types. Cold (new process) is the one to optimize first; warm and hot reuse more of what is already in memory.
- Read time to initial display (TTID) from the `Displayed` log line, and call `reportFullyDrawn()` (or Compose's `ReportDrawnWhen`) so you also get time to full display (TTFD).
- A Baseline Profile tells ART which classes and methods to compile ahead of time, so the first launches skip the slow interpreter phase. Generate it with `BaselineProfileRule` and the Baseline Profile Gradle plugin.
- Startup Profiles, derived from the same generator, let R8 lay out the DEX files so startup code is together. They need a release build optimized by R8.
- Replace scattered content-provider and `Application.onCreate` initializers with the App Startup library, and make non-essential ones lazy.

## Know which start you are measuring

The Android docs define three states:

- **Cold start:** the process does not exist. The system creates the process, initializes your objects, creates the host Activity, inflates or composes the UI, and draws the first frame. This is the first launch since boot or after the system killed the app, and it has the most work.
- **Warm start:** a subset of the cold-start work. The user backed out and relaunched, or the system evicted the process but the task can use saved instance state, so the process and Activity restart.
- **Hot start:** the process and Activity are still in memory and the system just brings the Activity to the foreground. It does the least work.

Play Console's Android vitals count a session as slow when a cold start takes 5 seconds or more, a warm start 2 seconds or more, or a hot start 1 second or more. Those are floors for "bad", not goals; your target should come from measuring your own app against your own baseline.

There are two timestamps. TTID is when the first frame is drawn; the system logs it as `Displayed` in Logcat (disable Logcat filters in Android Studio, because the system server prints it, not your app). TTFD is when the app is actually usable. The system cannot know that, so you tell it:

```kotlin
class FeedActivity : ComponentActivity() {
    private val viewModel: FeedViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val items by viewModel.items.collectAsState()
            // Reports "fully drawn" once the predicate is true.
            ReportDrawnWhen { items.isNotEmpty() }
            FeedScreen(items)
        }
    }
}
```

In View-based code, call `reportFullyDrawn()` on the Activity when the data is on screen. Compose also has `ReportDrawn` (immediately ready) and `ReportDrawnAfter` (after a suspending call completes).

For a quick check without writing a test, `adb shell am start -S -W com.example.app/.MainActivity` prints `ThisTime`, `TotalTime` and `WaitTime`, and the `Displayed` line appears in Logcat as usual. Use it for a smoke check, not for decisions: single runs are noisy.

## Measure with Macrobenchmark

Macrobenchmark launches your release-like app from a separate test module, repeats the launch, and reports statistics. The key idea is `CompilationMode`, which lets you compare "no ahead-of-time compilation" against "with a Baseline Profile" in the same test class.

```kotlin
@RunWith(AndroidJUnit4::class)
@LargeTest
class StartupBenchmark {
    @get:Rule
    val rule = MacrobenchmarkRule()

    @Test fun coldNoCompilation() = startup(CompilationMode.None())

    @Test fun coldWithBaselineProfile() = startup(CompilationMode.Partial())

    private fun startup(mode: CompilationMode) = rule.measureRepeated(
        packageName = "com.example.app",
        metrics = listOf(StartupTimingMetric()),
        compilationMode = mode,
        startupMode = StartupMode.COLD,
        iterations = 10,
        setupBlock = { pressHome() }
    ) {
        startActivityAndWait()
    }
}
```

`StartupTimingMetric` reports time to initial display, and time to full display once your app calls `reportFullyDrawn`. Newer Macrobenchmark releases also offer a `uiAutomator { }` scope for launching the app; check the release notes for the version you use.

Rules for trustworthy numbers:

1. Use a physical device, not an emulator, and the same one for every comparison.
2. Benchmark a non-debuggable, minified build that is as close to release as possible.
3. Run enough iterations to see the spread, and compare medians, not a single run.
4. Change one thing between runs.

## Baseline Profiles

A Baseline Profile is a list of classes and methods that ART should compile ahead of time. Without one, the first launches after install or update run much of your startup path in the interpreter, and the runtime only compiles hot code over time. With one, the code that your critical user journeys use is precompiled from day one. The Android docs say many apps see roughly a 30% improvement; treat that as a reason to try it, not a promise, and measure your own app.

The Baseline Profile Gradle plugin is the supported workflow. The generator lives in a `com.android.test` module (Android Studio has a Baseline Profile Generator module template):

```kotlin
// :baseline-profile/build.gradle.kts
plugins {
    id("com.android.test")
    id("androidx.baselineprofile")
}

android {
    targetProjectPath = ":app"
}

baselineProfile {
    // Use the connected device; per the docs it must be rooted or API 33+.
    useConnectedDevices = true
}
```

```kotlin
// :app/build.gradle.kts
plugins {
    id("com.android.application")
    id("androidx.baselineprofile")
}

dependencies {
    baselineProfile(project(":baseline-profile"))
}
```

```kotlin
class BaselineProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() = rule.collect(
        packageName = "com.example.app",
        includeInStartupProfile = true
    ) {
        startActivityAndWait()
        // Add the journeys users hit often: scroll the feed, open a detail screen.
    }
}
```

Generate it with `./gradlew :app:generateBaselineProfile` and commit the output. Profiles go stale as code changes, so regenerate them as part of the release process, and cover real journeys beyond launch (scrolling, navigation), because a profile that only starts the app only speeds up the start.

The `androidx.profileinstaller:profileinstaller` library installs the profile for installs that do not come from Google Play, such as local runs; check whether your setup already pulls it in.

### Startup Profiles

`includeInStartupProfile = true` marks the startup journey so the same run produces a Startup Profile. This one is used at build time: R8 uses it to lay out your DEX files so the code needed at startup lands in the primary DEX. According to the Android docs, DEX layout optimization only works if your release build is obfuscated and optimized by R8. Set `includeInStartupProfile` only on rules that are really about startup, because everything in a Startup Profile competes for that primary DEX space. AGP 8.2 added R8 rewriting of profile rules, so you can generate profiles from an unminified build and apply them to the minified release.

## Initialize less, later: App Startup

Libraries that initialize themselves through their own content providers each pay provider setup before `Application.onCreate` even runs. The App Startup library replaces them with one provider, `InitializationProvider`, that runs your `Initializer`s in dependency order.

```kotlin
class AnalyticsInitializer : Initializer<AnalyticsClient> {
    override fun create(context: Context): AnalyticsClient =
        AnalyticsClient.create(context)

    override fun dependencies(): List<Class<out Initializer<*>>> = emptyList()
}
```

```xml
<provider
    android:name="androidx.startup.InitializationProvider"
    android:authorities="${applicationId}.androidx-startup"
    android:exported="false"
    tools:node="merge">
    <meta-data
        android:name="com.example.AnalyticsInitializer"
        android:value="androidx.startup" />
</provider>
```

`AnalyticsClient` is a stand-in for whatever you initialize. Components that are not needed at launch should not run at launch. Remove the automatic entry with `tools:node="remove"` on the `<meta-data>`, then initialize on demand:

```kotlin
AppInitializer.getInstance(context)
    .initializeComponent(AnalyticsInitializer::class.java)
```

Initializers still run on the main thread, so this reorganizes and defers work; it does not make slow work fast.

## Common mistakes

- **Benchmarking a debug build.** Debug builds disable optimizations, and the numbers have no relationship to release. Benchmark a minified, non-debuggable variant.
- **Judging startup from one run.** Variance between launches is large. Use Macrobenchmark with several iterations and compare medians.
- **Only measuring TTID.** An app that shows a spinner fast but loads content late still feels slow. Call `reportFullyDrawn` when the screen is usable so TTFD is measured.
- **A profile that only launches the app.** Baseline Profiles cover the journeys you script. Add scrolling and navigation for the screens users actually reach.
- **Never regenerating the profile.** A stale profile covers old code. Regenerate it per release.
- **Marking every test as startup.** Putting non-startup journeys in the Startup Profile crowds the primary DEX. Use `includeInStartupProfile` only for the launch path.
- **Moving work into App Startup and calling it fixed.** The initializers still run on the main thread at launch unless you make them lazy. Remove what is not needed for the first frame.

## If you know iOS

iOS also distinguishes cold and warm launches, and its closest counterpart to the measuring workflow is Xcode's `XCTApplicationLaunchMetric` in performance tests plus the App Launch template in Instruments. Because Swift is compiled ahead of time, there is no counterpart to Baseline Profiles: the interpreter-and-JIT warm-up phase they remove is an ART trait. Work that runs before the first frame is the shared lesson, whether it is `Application.onCreate` and content providers on Android or `didFinishLaunching` and static initializers on iOS. See the Equivalents page for the full mapping.

## Further reading

- [App startup time](https://developer.android.com/topic/performance/vitals/launch-time)
- [Create Baseline Profiles](https://developer.android.com/topic/performance/baselineprofiles/create-baselineprofile)
- [Macrobenchmark overview](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [App Startup library](https://developer.android.com/topic/libraries/app-startup)
