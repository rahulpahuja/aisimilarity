---
title: "Android Runtime Permissions, Photo Picker and Notifications"
slug: runtime-permissions-photo-picker-android
date: 2026-11-02
order: 17
category: "Platform & Performance"
tags: [permissions, photo-picker, notifications, activity-result, privacy]
summary: "Ask for permissions in context, handle permanent denial, replace storage permissions with the Photo Picker, and request POST_NOTIFICATIONS well."
---

The permission dialog is a budget, not a feature. Ask at launch and the user taps Deny; ask twice and Android stops showing the dialog at all. The goal of a good permission flow is to avoid asking whenever you can, and to ask at the one moment the user understands why.

## TL;DR

- Request a permission when the user taps the feature that needs it, never at app start. Check `checkSelfPermission` every time instead of caching the answer.
- Use the Activity Result API (`rememberLauncherForActivityResult` in Compose). Show your own rationale before the system dialog when `shouldShowRequestPermissionRationale` is true, and send the user to app settings after a permanent denial.
- For picking photos and videos, use the Photo Picker. It needs no permission and gives you only the items the user selected.
- If you must read the whole media library, on Android 14 and up also declare `READ_MEDIA_VISUAL_USER_SELECTED` and handle partial access.
- On Android 13 and up, notifications are off until the user grants `POST_NOTIFICATIONS`. Wait until the user has seen value before asking.

## The request flow, including permanent denial

The platform rule, from the Android permissions docs: if the user taps Deny for a permission more than once over the app's lifetime on a device, the system no longer shows the dialog, and the request is treated as a permanent denial. So the flow has three states, not two.

1. Already granted: just do the thing.
2. Not granted and `shouldShowRequestPermissionRationale` is true: the user denied once. Explain, then launch the request from your explanation's "Continue" button.
3. Not granted and no rationale: either the very first request or a permanent denial. Launch the request. If it comes back denied and there is still no rationale, it was a permanent denial: offer a route to settings.

`shouldShowRequestPermissionRationale` returns false both before the first request and after a permanent denial, which is why state 3 is resolved in the result callback rather than before launching.

```kotlin
private fun Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

@Composable
fun CameraEntry(onCameraReady: () -> Unit) {
    val context = LocalContext.current
    val permission = Manifest.permission.CAMERA
    var showRationale by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val activity = context.findActivity()
        when {
            granted -> onCameraReady()
            activity != null &&
                !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission) ->
                showSettings = true // denied, and the system will not ask again
            else -> Unit // soft denial: leave the feature off, keep the app usable
        }
    }

    Button(onClick = {
        val activity = context.findActivity()
        when {
            ContextCompat.checkSelfPermission(context, permission) ==
                PackageManager.PERMISSION_GRANTED -> onCameraReady()
            activity != null &&
                ActivityCompat.shouldShowRequestPermissionRationale(activity, permission) ->
                showRationale = true
            else -> launcher.launch(permission)
        }
    }) { Text("Scan document") }

    if (showRationale) {
        AlertDialog(
            onDismissRequest = { showRationale = false },
            title = { Text("Camera access") },
            text = { Text("The camera is used only to scan the document you are adding.") },
            confirmButton = {
                TextButton(onClick = { showRationale = false; launcher.launch(permission) }) {
                    Text("Continue")
                }
            },
            dismissButton = { TextButton(onClick = { showRationale = false }) { Text("Not now") } }
        )
    }

    if (showSettings) {
        AlertDialog(
            onDismissRequest = { showSettings = false },
            title = { Text("Camera is turned off") },
            text = { Text("You can enable it in the app settings.") },
            confirmButton = {
                TextButton(onClick = {
                    showSettings = false
                    context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", context.packageName, null)
                        }
                    )
                }) { Text("Open settings") }
            },
            dismissButton = { TextButton(onClick = { showSettings = false }) { Text("Cancel") } }
        )
    }
}
```

Two rules that this code encodes. First, never cache the grant in a field: the user can revoke it from system settings at any time, and Android also auto-resets permissions for apps that go unused for months. Check at the point of use, and wrap permission-protected framework calls in a `try`/`catch` for `SecurityException`. Second, never loop on denial. Location, camera and microphone also offer "Only this time" on Android 11 and up, so a one-time grant can vanish between sessions; that is normal.

If you need foreground and background location, request them in two separate steps. Android 11 and up will not grant both from a single request.

## Use the Photo Picker instead of storage permissions

If the user is choosing images or videos to attach, upload or edit, you do not need `READ_MEDIA_IMAGES` or `READ_EXTERNAL_STORAGE`. The Photo Picker is a system UI that returns URIs for only what the user selects, with no permission prompt.

```kotlin
@Composable
fun AttachPhotos(onPicked: (List<Uri>) -> Unit) {
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(maxItems = 5)
    ) { uris -> if (uris.isNotEmpty()) onPicked(uris) }

    Button(onClick = {
        picker.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        )
    }) { Text("Add photos") }
}
```

For a single item use `ActivityResultContracts.PickVisualMedia()` with the same request object. `ImageAndVideo`, `VideoOnly` and `SingleMimeType("image/gif")` are the other media types. The platform caps how many items the user can select; read the limit with `MediaStore.getPickImagesMaxLimit()` instead of hard-coding it. On devices without the picker, the fallback uses `ACTION_OPEN_DOCUMENT` and ignores your maximum, so validate the count you receive.

The picker is part of the platform on Android 11 (API 30) and up when the device receives Google System Updates, and Google Play services backports it to Android 4.4 through 10. To get the backport, add this service entry to your manifest (it comes from the official docs):

```xml
<service
    android:name="com.google.android.gms.metadata.ModuleDependencies"
    android:enabled="false"
    android:exported="false"
    tools:ignore="MissingClass">
    <intent-filter>
        <action android:name="com.google.android.gms.metadata.MODULE_DEPENDENCIES" />
    </intent-filter>
    <meta-data android:name="photopicker_activity:0:required" android:value="" />
</service>
```

Picker URIs are meant for reading now. If you need the file later, copy it into your app storage instead of assuming the URI stays readable.

## When you really need the media library: partial access

Gallery apps, backup tools and editors that browse the whole library cannot use the picker. Android 13 split storage access into `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and `READ_MEDIA_AUDIO`. Android 14 added a user choice to grant access to selected photos and videos only. To support it, declare the extra permission alongside the others and request the right set per API level:

```xml
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
<uses-permission
    android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
```

```kotlin
enum class MediaAccess { Full, Partial, None }

fun mediaAccess(context: Context): MediaAccess {
    fun granted(p: String) =
        ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
    return when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> when {
            granted(Manifest.permission.READ_MEDIA_IMAGES) ||
                granted(Manifest.permission.READ_MEDIA_VIDEO) -> MediaAccess.Full
            granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> MediaAccess.Partial
            else -> MediaAccess.None
        }
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
            if (granted(Manifest.permission.READ_MEDIA_IMAGES)) MediaAccess.Full else MediaAccess.None
        else ->
            if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) MediaAccess.Full else MediaAccess.None
    }
}
```

With `Partial`, query MediaStore as usual and you will see only the selected items. Offer a way to change the selection rather than treating it as an error. Per the Android docs, an app that targets Android 14 but does not declare the new permission runs in a compatibility mode. Separately, Google Play has a policy restricting who may use the broad photo and video permissions; check the current policy text before you ship them.

## Notifications: POST_NOTIFICATIONS

On Android 13 (API 33) and up, notifications from a newly installed app are off by default until the user grants `POST_NOTIFICATIONS`. If you target API 32 or lower, the system prompts for you the first time you create a notification channel, usually at startup, and you lose control of timing. Target 33 or higher and ask yourself.

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

```kotlin
@Composable
fun ReminderToggle(onEnabled: () -> Unit) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) onEnabled() }

    Switch(checked = false, onCheckedChange = {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            onEnabled()
        } else {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    })
}
```

Ask when the user turns on something that needs notifications, such as a reminder, not on the first screen. Starting a foreground service does not require the permission, but you must still post the service's notification. Use the same rationale and settings-redirect flow as above if the user denies.

## Common mistakes

- **Requesting everything on first launch.** Users deny what they do not understand, and two denials end your ability to ask. Request per feature, at the moment of use.
- **Caching `isGranted` in a field or ViewModel.** The user can revoke it in settings while your app is alive. Call `checkSelfPermission` at each use and catch `SecurityException`.
- **Treating "no rationale" as "permanently denied" before the first request.** The rationale flag is also false before you ever ask. Decide about permanent denial in the result callback.
- **Re-launching the request in a loop on denial.** The second denial is final. Show a settings link instead.
- **Asking for storage permissions to let the user pick a photo.** You collect data you do not need and invite a Play policy review. Use `PickVisualMedia`.
- **Requesting `READ_MEDIA_IMAGES` alone on Android 14.** Without `READ_MEDIA_VISUAL_USER_SELECTED` declared, the app runs in compatibility mode and you cannot handle partial access properly.
- **Registering a launcher inside a click handler in View-based code.** `registerForActivityResult` must run unconditionally before the Activity or Fragment reaches `STARTED`, typically as a property initializer, and only `launch` is called from the handler. In Compose, `rememberLauncherForActivityResult` does this for you.

## If you know iOS

The model is similar: iOS also shows a one-shot system prompt per permission, and denying is effectively final until the user visits Settings, so asking in context matters there too. `PHPickerViewController` (and SwiftUI's `PhotosPicker`) is the direct counterpart of the Android Photo Picker, and iOS "Limited Library" access corresponds to Android 14's partial media access. The main difference is that iOS needs a purpose string per permission in `Info.plist`, whereas Android uses the manifest and a system-provided dialog. See the Equivalents page for the full mapping.

## Further reading

- [Request runtime permissions](https://developer.android.com/training/permissions/requesting)
- [Photo picker](https://developer.android.com/training/data-storage/shared/photopicker)
- [Partial photo and video access (Android 14)](https://developer.android.com/about/versions/14/changes/partial-photo-video-access)
- [Notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
