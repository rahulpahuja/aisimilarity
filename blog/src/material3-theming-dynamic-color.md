---
title: "Material 3 theming in Compose: dynamic color and tokens"
slug: material3-theming-dynamic-color
date: 2026-11-02
order: 4
category: "Jetpack Compose"
tags: [compose, material3, theming, dynamic-color]
summary: "Build a Material 3 theme in Compose: ColorScheme, dynamic color on Android 12+, typography, shapes, dark mode, and tokens instead of hard-coded colors."
---

Hard-coded colors are the main reason Compose apps break in dark mode, look wrong next to the system, and cost a week of find-and-replace at the first rebrand. `Color(0xFF6200EE)` in a composable is a decision made in the wrong place. Material 3 in Compose gives you a token system, `MaterialTheme.colorScheme`, `typography` and `shapes`, so components ask for a role ("primary", "surfaceContainer", "bodyLarge") and the theme answers. This post builds a complete theme and shows where it commonly goes wrong.

## TL;DR

- Wrap your app in one `AppTheme` composable that builds a `ColorScheme`, `Typography` and `Shapes` and passes them to `MaterialTheme`.
- Pick the color scheme by priority: dynamic color on Android 12+ (API 31) when enabled, otherwise your brand light or dark scheme.
- In composables, read `MaterialTheme.colorScheme.*`, `MaterialTheme.typography.*` and `MaterialTheme.shapes.*`. Never reference a raw `Color(...)` for UI that should follow the theme.
- Pair every container color with its `on` color (`primary` with `onPrimary`, `surface` with `onSurface`) to keep contrast correct in every scheme.
- For design tokens Material does not model (success, warning, brand gradients), add your own through a `CompositionLocal`.

## The theme wrapper

One function owns the decision. Everything in the app lives beneath it.

```kotlin
private val LightColors = lightColorScheme(
    primary = Color(0xFF3F5F90),
    onPrimary = Color(0xFFFFFFFF),
    secondary = Color(0xFF565F71),
    onSecondary = Color(0xFFFFFFFF),
    // Fill in the remaining roles from a generated palette.
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA8C8FF),
    onPrimary = Color(0xFF05305F),
    secondary = Color(0xFFBEC6DC),
    onSecondary = Color(0xFF283141),
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}
```

`lightColorScheme()` and `darkColorScheme()` fill in defaults for any role you omit, which is fine for a prototype and risky for a shipped app: the omitted roles come from the baseline purple palette and will clash with your brand. Generate a complete palette from one source color with the Material Theme Builder, then paste in every role.

Wire it at the root, once:

```kotlin
setContent {
    AppTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AppNavigation()
        }
    }
}
```

## Dynamic color

On Android 12 and later the system derives a palette from the user's wallpaper. `dynamicLightColorScheme(context)` and `dynamicDarkColorScheme(context)` return a complete `ColorScheme` built from it, with every role filled and contrast handled. Because the check is on `Build.VERSION.SDK_INT`, the same code falls back to your brand schemes on older devices.

Make an explicit product decision about dynamic color rather than leaving the default on:

- It is a good default for utility and productivity apps, where matching the system feels native.
- It is a poor fit when brand color carries meaning: a banking app's red for alerts, a sports app's team colors. Turn it off, or keep brand colors for specific components and use dynamic color elsewhere.
- Expose it as a user setting if your audience cares. The `dynamicColor` parameter above is the seam for that; persist the choice in DataStore and pass it in.

Test both paths. Previews and screenshot tests usually run with your brand palette, so a screen that looks right there can still have unreadable text on a wallpaper-derived scheme if you hard-coded a foreground. Check on a real Android 12+ device with a few different wallpapers.

## Typography

`Typography` holds 15 text styles in five roles (display, headline, title, body, label) and three sizes each. Override the ones you use; the rest keep defaults. Start by changing the font family once, so every style follows.

```kotlin
private val BrandFont = FontFamily(
    Font(R.font.brand_regular, FontWeight.Normal),
    Font(R.font.brand_medium, FontWeight.Medium),
    Font(R.font.brand_bold, FontWeight.Bold),
)

private val Base = Typography()

val AppTypography = Typography(
    displayLarge = Base.displayLarge.copy(fontFamily = BrandFont),
    headlineMedium = Base.headlineMedium.copy(fontFamily = BrandFont),
    titleLarge = Base.titleLarge.copy(fontFamily = BrandFont, fontWeight = FontWeight.Medium),
    bodyLarge = Base.bodyLarge.copy(fontFamily = BrandFont),
    bodyMedium = Base.bodyMedium.copy(fontFamily = BrandFont),
    labelLarge = Base.labelLarge.copy(fontFamily = BrandFont),
)
```

Use styles by role: `Text("Title", style = MaterialTheme.typography.titleLarge)`. Specify sizes in `sp` so text respects the user's font scale, and never fix a container's height to the text height. Both are common reasons a layout clips at large font settings. The official docs also cover downloadable fonts as an alternative to bundled font files.

## Shapes

`Shapes` defines five corner sizes (extra small through extra large). Components pick the size that fits their role: buttons, cards and dialogs each default to a different one.

```kotlin
val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)
```

Change them once here and every component follows. For one-off cases, use `MaterialTheme.shapes.medium` with `Modifier.clip(...)` rather than a new literal `RoundedCornerShape(12.dp)`.

## Using tokens, not colors

The rule is simple and has two halves. Use a role, and use its pair.

```kotlin
@Composable
fun StatusBanner(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = modifier,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(16.dp),
        )
    }
}
```

`Surface` with `contentColor` sets `LocalContentColor` for its children, so the `Text` inherits the right foreground without naming it. This is the mechanism that keeps contrast correct in light, dark and dynamic schemes alike.

Material 3 surfaces use a family of container roles (`surfaceContainerLow`, `surfaceContainer`, `surfaceContainerHigh`) for elevation-like layering instead of shadows. Prefer those over inventing grays.

### Custom tokens

Material has no "success" or "warning" role. Add your own as a typed, themed extension and provide it through a `CompositionLocal`:

```kotlin
@Immutable
data class ExtraColors(
    val success: Color,
    val onSuccess: Color,
    val warning: Color,
    val onWarning: Color,
)

val LocalExtraColors = staticCompositionLocalOf<ExtraColors> {
    error("ExtraColors not provided. Wrap your content in AppTheme.")
}

val MaterialTheme.extraColors: ExtraColors
    @Composable get() = LocalExtraColors.current
```

Inside `AppTheme`, choose the light or dark `ExtraColors` by `darkTheme` and wrap `content` in `CompositionLocalProvider(LocalExtraColors provides extra)`. Callers then write `MaterialTheme.extraColors.success`. `staticCompositionLocalOf` is appropriate here because the value changes rarely (light to dark), and a change recomposes everything below. Note that dynamic color does not generate these extra roles; define dark and light variants yourself and check their contrast against the dynamic surfaces they sit on.

## Common mistakes

- **Hard-coded `Color(...)` in screens.** Consequence: unreadable text in dark mode and a painful rebrand. Fix: read from `MaterialTheme.colorScheme`, and keep literals only inside the theme file.
- **Using `Color.White` and `Color.Black` for text and backgrounds.** Consequence: low contrast on dynamic schemes. Fix: `onSurface` on `surface`, `onPrimary` on `primary`.
- **Calling `dynamicColorScheme` below API 31.** Consequence: runtime failure on Android 11 and below. Fix: guard with `Build.VERSION.SDK_INT >= Build.VERSION_CODES.S` as shown.
- **Partial `lightColorScheme(primary = ...)` overrides.** Consequence: unspecified roles keep the baseline purple, so containers and chips look off-brand. Fix: generate and set every role.
- **Forgetting the system bars.** Consequence: a light status bar icon on a light surface in dark mode. Fix: with `enableEdgeToEdge()` the bar style follows the system dark mode, so if your app has its own theme override, pass matching `SystemBarStyle` values based on `darkTheme`.
- **Nesting `MaterialTheme` carelessly.** Consequence: an inner theme resets typography or shapes. Fix: build an inner theme from `MaterialTheme.colorScheme.copy(...)` so the roles you do not change carry over.

## If you know iOS

`MaterialTheme.colorScheme` plays the part of SwiftUI's semantic colors (`Color.primary`, `Color.secondary`, system backgrounds) and asset-catalog colors with light and dark variants. Dynamic color is closest to the system accent and tint behavior, though iOS does not derive a whole palette from the wallpaper. The typography roles line up with `Font.TextStyle` such as `.title` and `.body`, which also scale with Dynamic Type just as `sp` scales with font size. See the Equivalents page for the broader mapping.

## Further reading

- [Material Design 3 in Compose](https://developer.android.com/develop/ui/compose/designsystems/material3)
- [Custom design systems in Compose](https://developer.android.com/develop/ui/compose/designsystems/custom)
- [Fonts in Compose](https://developer.android.com/develop/ui/compose/text/fonts)
