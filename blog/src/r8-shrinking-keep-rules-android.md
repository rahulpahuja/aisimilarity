---
title: "R8 on Android: Shrinking, Keep Rules and Release-Only Crashes"
slug: r8-shrinking-keep-rules-android
date: 2026-11-02
order: 18
category: "Platform & Performance"
tags: [r8, proguard, minify, keep-rules, release-build]
summary: "What R8 shrinks, optimizes and renames, how to write narrow keep rules, why broad ones hurt, and how to read mapping files when only the release build crashes."
---

The debug build works. The release build crashes on launch with a `ClassNotFoundException`, or worse, silently loses data because a JSON field was renamed. R8 did exactly what you asked it to, and you asked it to remove or rename something that code reaches by name at runtime. Fixing that well means writing the smallest possible keep rule, not the biggest.

## TL;DR

- R8 does four jobs: removes unused code, optimizes what remains, renames classes and members, and (with resource shrinking) removes unused resources.
- Turn it on for release with `isMinifyEnabled` and `isShrinkResources`, use `proguard-android-optimize.txt`, and test the minified build, not only debug.
- Keep rules are only needed for code reached by reflection, name lookup or native code. Most library and AndroidX rules already ship inside the dependencies.
- A broad rule like `-keep class com.example.** { *; }` disables shrinking, optimization and renaming for everything it matches. Scope rules to the class and member that need them.
- Keep the `mapping.txt` for every release you ship, and use retrace (or Play Console deobfuscation) to read production stack traces.

## What R8 actually does

| Step | What it does | What breaks when it goes wrong |
|---|---|---|
| Shrinking | Removes classes, methods and fields that are not reachable from the entry points | A class used only via reflection disappears |
| Optimization | Inlines, merges and rewrites code across the whole program | Reflection on a member that was inlined or removed |
| Obfuscation | Renames classes, methods and fields to short names | Anything that looks up a name as a string: `Class.forName`, JSON field names, JNI |
| Resource shrinking | Removes resources not referenced by the shrunk code | Resources loaded by a dynamically built name |

R8 starts from entry points, such as the components in your manifest and classes referenced from layouts (the Android build generates keep rules for these), and keeps what they can reach. A keep rule adds more entry points. That is why every rule has a cost: it changes the reachable set.

## Enable it, with the right defaults

```kotlin
android {
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
```

Use the `-optimize` default file; the Android docs note that support for `proguard-android.txt` has been dropped in newer AGP versions. R8's full mode has been the default since AGP 8.0, so if your `gradle.properties` still contains `android.enableR8.fullMode=false`, remove it. On AGP 9.0 and later optimized resource shrinking is on automatically when `isShrinkResources` is true.

AGP 9.3 introduced a simplified `optimization { enable = true }` block and a `src/<variant>/keepRules` source set for `.keep` files, and the legacy DSL above remains supported. Check the AGP release notes for your version before migrating.

## Writing keep rules that earn their keep

First rule: do not write one until you have evidence something needs it. AAPT2 already generates rules for manifest components and classes referenced from XML, and AndroidX, Kotlin and most popular libraries ship consumer rules in their artifacts. Hand-written rules for `androidx.**`, `kotlin.**`, `Activity` subclasses and common library internals are usually redundant, and they get in R8's way.

When something genuinely is reached by name, say what you need to keep:

```bash
-keep class com.example.plugin.PluginImpl { <init>(); }
-keepclassmembers class com.example.net.LegacyDto { <fields>; }
-keepnames class com.example.plugin.PluginRegistry
```

In order, these keep a class that is instantiated with `Class.forName("com.example.plugin.PluginImpl")` along with its no-argument constructor; the fields of a legacy DTO that a reflective JSON library reads by name; and the name of a class that is looked up by name but may still be removed if nothing uses it.

A few things worth knowing about the syntax:

- `-keep` keeps the class and the members you list from being removed or renamed.
- `-keepclassmembers` keeps members but lets the class itself be shrunk if nothing uses it.
- `-keepnames` stops renaming but still allows removal.
- Modifiers such as `allowobfuscation` and `allowshrinking` relax a `-keep` selectively.
- Annotation-based rules link the rule to the code. `androidx.annotation.Keep` works this way, and the Android keep-rules guide also describes Jetpack Keep, which generates rules from annotations in your code.

Better still, avoid reflection that needs rules at all. Code-generating serializers (kotlinx.serialization, Moshi codegen) do not need field-name keeps, and recent Gson versions ship rules for `@SerializedName` fields. Check your library's documentation for current guidance.

### Why broad keeps hurt

Rules like these are the ones to avoid:

```bash
-keep class com.example.** { *; }
-keep class androidx.** { *; }
-dontobfuscate
-dontoptimize
```

`-keep class com.example.** { *; }` matches every class in your package tree and every member of each, so none of them can be removed, renamed or optimized, and everything they reference stays reachable too. You pay in APK size, startup work and exposed names, and the bug you were chasing still may not be fixed. `-dontobfuscate` and its siblings turn off a whole phase for the entire app, and a negated rule such as `-keep class !com.example.ui.** { *; }` is the same mistake in reverse. Treat any global flag as a defect to be justified in code review.

Be equally careful with `-dontwarn`. A blanket `-dontwarn` hides missing-class warnings that often point at a missing keep rule or an unneeded dependency.

## Read the mapping file

Every minified build produces `app/build/outputs/mapping/release/mapping.txt`. It maps original names to obfuscated ones; a trimmed, illustrative excerpt looks like this:

```bash
com.example.data.UserRepository -> a.b.c:
    com.example.data.User fetchUser(java.lang.String) -> a
    1:5:void refresh() -> b
```

A production trace such as `at a.b.c.a(SourceFile:12)` is unreadable until you retrace it. Pass the mapping file to the retrace tool from the command-line tools package, which the SDK Manager installs under `cmdline-tools/<version>/bin/`:

```bash
retrace app/build/outputs/mapping/release/mapping.txt crash.txt
```

For Play-distributed apps, the mapping file is part of the uploaded bundle, so Play Console shows deobfuscated crash and ANR clusters. For anything else (Crashlytics, your own backend), upload the mapping file as part of CI. Archive it per version code; a mapping from a different build is worse than none because it silently produces wrong names.

If retraced traces lack line numbers, check that the `SourceFile` and `LineNumberTable` attributes are being kept; the Android shrinking docs describe the options.

## Debugging a release-only crash

1. **Reproduce on a minified build you can install.** Create a build type that copies release (`initWith(getByName("release"))`), signs with the debug key and is otherwise identical, so you do not need production credentials.
2. **Retrace the trace.** `ClassNotFoundException`, `NoSuchMethodException` and `NoSuchFieldException` point to a reflective lookup. `NullPointerException` on a field that is always set in debug points to a renamed or removed JSON field. `UnsatisfiedLinkError` with a Java method name points to JNI.
3. **Find the entry point that reaches the thing by name.** That is where your rule goes.
4. **Ask R8 why.** Add `-whyareyoukeeping class com.example.Foo` to see which rule or reference keeps a class, and inspect `configuration.txt`, `seeds.txt` and `usage.txt` next to `mapping.txt` to see the merged rules, kept items and removed code. When R8 fails on missing classes it prints suggested rules, and AGP also writes them to `missing_rules.txt`.
5. **Write the narrowest rule that fixes it**, rebuild, and confirm. Then delete any broader rule you added while experimenting.

Newer AGP releases also add tooling that reports which keep rules retain the most code. If you inherited a large rules file, check the AGP release notes for your version and use it to rank rules by impact before deleting anything.

## Common mistakes

- **Fixing a crash with `-keep class com.example.** { *; }`.** The crash goes away because nothing is shrunk or renamed. You lose the size and speed benefits for the whole app. Find the one reflective entry point instead.
- **Testing only the debug build.** R8 only runs on minified variants, so a green debug test run proves nothing about release. Run a smoke test or instrumented tests against a minified build in CI.
- **Copying old rule files between projects.** Rules for `androidx.**`, Activities, old library versions and `-dontoptimize` linger for years. Delete them and keep only what a failing test demands.
- **Not archiving `mapping.txt`.** Without the matching file, a production trace stays obfuscated. Store it with the release artifact and upload it to your crash reporter.
- **Reflecting on class names in your own code.** `Class.forName("com.example.Foo")` or string-built names defeat shrinking and obfuscation. Prefer direct references, an interface plus a registry, or an annotation that generates keep rules.
- **Blanket `-dontwarn`.** It silences genuine missing-class problems. Fix the dependency or add the specific `-dontwarn` that R8 suggests.

## If you know iOS

Swift is compiled ahead of time and the linker strips unused code, but symbol names are not usually reflected at runtime, so there is no direct equivalent of keep rules for ordinary Swift code. The closest relatives are dead-code stripping at link time, App Thinning and symbolication with dSYM files. A dSYM plays the role of `mapping.txt`: archive it per release and your crash reporter uses it to resolve addresses. Objective-C runtime lookups by string are the iOS analogue of Android reflection. See the Equivalents page for related tooling.

## Further reading

- [Enable app optimization (R8)](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)
- [Add keep rules](https://developer.android.com/topic/performance/app-optimization/add-keep-rules)
- [Shrink, obfuscate and optimize your app](https://developer.android.com/build/shrink-code)
- [R8 retrace](https://developer.android.com/studio/command-line/retrace)
