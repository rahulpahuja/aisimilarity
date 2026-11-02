---
title: "DataStore vs SharedPreferences: what to use and how to migrate"
slug: datastore-vs-sharedpreferences
date: 2026-11-02
order: 12
category: "Data & Networking"
tags: [datastore, sharedpreferences, storage, migration, room]
summary: "Preferences DataStore, Proto DataStore and SharedPreferences compared: why apply() can stall the main thread, how to migrate, and when Room fits better."
---

SharedPreferences looks like the simplest storage API on Android, and that is the trap. Its reads block until the file is loaded, its `apply()` is asynchronous only until the next lifecycle event, and its failures surface as runtime exceptions. Jetpack DataStore replaces it with a coroutine- and Flow-based API that has defined error handling and atomic updates. This post explains the differences, shows both DataStore flavours, and covers the migration and the cases where neither is the right tool.

## TL;DR

- Use **Preferences DataStore** for a handful of independent key-value settings; use **Proto DataStore** when you want a typed, versioned object.
- Both are asynchronous, expose a `Flow`, and update atomically with a transactional `updateData`/`edit`.
- Create exactly one `DataStore` instance per file per process, as a top-level property delegate.
- Migrate with `SharedPreferencesMigration`; it runs before the first read and removes the migrated keys.
- Lists of records, anything you query, or anything large belongs in Room, not DataStore.

## Why SharedPreferences causes trouble

The platform documentation for DataStore spells out the problems it fixes:

- The API looks safe on the main thread but performs disk I/O. The first `getString()` blocks until the whole file has been read.
- `apply()` updates memory immediately and writes to disk later, but pending writes are flushed (waited on) when an activity or service starts or stops. A slow flush there is a main-thread stall, and it shows up as ANRs in the field.
- `commit()` is synchronous: it does the disk write on whatever thread you call it from. On the main thread that is a guaranteed jank source.
- Parse errors are thrown as runtime exceptions, there is no way to observe changes with a `Flow`, and there is no type safety beyond the getter you pick.
- Multi-process use (`MODE_MULTI_PROCESS`) is deprecated and was never reliable.

None of this makes small, rarely-written SharedPreferences files dangerous in a stable app. It makes them a poor choice for new code, and a recurring cause of ANR reports in old code.

## Preferences DataStore

```kotlin
// build.gradle.kts: androidx.datastore:datastore-preferences

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "settings",
    produceMigrations = { context ->
        listOf(SharedPreferencesMigration(context, "legacy_settings"))
    },
)

object SettingsKeys {
    val DarkMode = booleanPreferencesKey("dark_mode")
    val Username = stringPreferencesKey("username")
}

class SettingsRepository(private val dataStore: DataStore<Preferences>) {

    val darkMode: Flow<Boolean> = dataStore.data
        .catch { e ->
            if (e is IOException) emit(emptyPreferences()) else throw e
        }
        .map { prefs -> prefs[SettingsKeys.DarkMode] ?: false }

    suspend fun setDarkMode(enabled: Boolean) {
        dataStore.edit { prefs -> prefs[SettingsKeys.DarkMode] = enabled }
    }
}
```

Points that matter:

- `dataStore.data` is a cold `Flow` that re-emits the whole `Preferences` snapshot on any change. Map it to the value you care about, and add `distinctUntilChanged()` if downstream work is expensive.
- `edit` is a suspend function that runs your block transactionally. Concurrent edits are serialised.
- IO errors during reads arrive as `IOException` in the flow, so handle them in `catch`. Corruption throws `CorruptionException`; supply a `corruptionHandler` if you want to reset to defaults.
- The property delegate must be top-level (or otherwise a singleton). Two instances for the same file in one process throws `IllegalStateException`.

## Proto DataStore

Proto DataStore stores a whole typed object and gives you a schema you control. The official guide uses Protocol Buffers. You can also write your own `Serializer`, which lets you use kotlinx.serialization with JSON and skip the protobuf toolchain.

```kotlin
// build.gradle.kts: androidx.datastore:datastore, org.jetbrains.kotlinx:kotlinx-serialization-json

@Serializable
data class UserSettings(
    val darkMode: Boolean = false,
    val username: String = "",
    val notificationHour: Int = 9,
)

object UserSettingsSerializer : Serializer<UserSettings> {
    override val defaultValue: UserSettings = UserSettings()

    override suspend fun readFrom(input: InputStream): UserSettings =
        try {
            Json.decodeFromString(UserSettings.serializer(), input.readBytes().decodeToString())
        } catch (e: SerializationException) {
            throw CorruptionException("Cannot read UserSettings", e)
        }

    override suspend fun writeTo(t: UserSettings, output: OutputStream) {
        output.write(Json.encodeToString(UserSettings.serializer(), t).encodeToByteArray())
    }
}

private val Context.userSettingsStore: DataStore<UserSettings> by dataStore(
    fileName = "user_settings.json",
    serializer = UserSettingsSerializer,
)

suspend fun DataStore<UserSettings>.setDarkMode(enabled: Boolean) =
    updateData { current -> current.copy(darkMode = enabled) }
```

Choose a typed store when settings are related (changing one should be consistent with another) or when you want defaults and evolution in one place. Give new fields default values so older files still decode. Do not rename serialized fields casually; that is your schema.

## Migrating from SharedPreferences

`SharedPreferencesMigration` copies the old values into the DataStore the first time it is accessed. DataStore runs migrations before returning any data, so readers never see a half-migrated state. After success, the migrated keys are removed from the old file.

The same delegate from above, with the migration added:

```kotlin
private val Context.userSettingsStore: DataStore<UserSettings> by dataStore(
    fileName = "user_settings.json",
    serializer = UserSettingsSerializer,
    produceMigrations = { context ->
        listOf(
            SharedPreferencesMigration<UserSettings>(context, "legacy_settings") { prefs, current ->
                current.copy(
                    darkMode = prefs.getBoolean("dark_mode", current.darkMode),
                    username = prefs.getString("username", current.username) ?: current.username,
                )
            },
        )
    },
)
```

Keep the migration in the app for a few releases so users who skip versions are still covered, then delete it. Do not mix: once a setting lives in DataStore, stop writing it to SharedPreferences, or the two will drift.

## When Room is the answer

DataStore rewrites its whole file on every update and has no queries, partial reads, or relations. Use Room when you have:

- a list of records that grows (history, bookmarks, cached items)
- data you filter, sort or join
- data large enough that rewriting the file per change is wasteful

A rule of thumb that holds up: if you would name the thing "settings" or "state of this one user", DataStore; if you would name it a "table", Room. For secrets such as tokens, neither is encrypted by default. Use Android Keystore-backed encryption and check the current guidance, since `androidx.security:security-crypto` is deprecated.

## Common mistakes

- **Creating a `DataStore` inside a class or per call.** Two instances on one file throw `IllegalStateException`. Use a top-level `by preferencesDataStore`/`by dataStore` delegate or inject a singleton.
- **Using `runBlocking { dataStore.data.first() }` on the main thread** to get a value synchronously. That reintroduces the SharedPreferences blocking problem. Load once at startup off the main thread, or expose state as a `Flow`/`StateFlow`.
- **Not handling `IOException` in `data`.** One bad read terminates the flow and the collector crashes. Add `.catch`.
- **Reading, modifying and writing in separate steps.** `val x = data.first(); edit { it[k] = x + 1 }` races. Do the read-modify-write inside `edit` or `updateData`.
- **Storing a JSON-encoded list in a single preference.** It works until it is large. Move it to Room.

## If you know iOS

SharedPreferences maps to `UserDefaults`, and DataStore's role is closest to `@AppStorage` backed by `UserDefaults` or a small `Codable` file you read and write yourself. The main difference is the contract: DataStore gives you asynchronous access, a `Flow`, and transactional updates, while `UserDefaults` is synchronous and cached in memory. For records you query, Room corresponds to SwiftData or Core Data. See the Equivalents page for the storage mapping.

## Further reading

- [DataStore overview](https://developer.android.com/topic/libraries/architecture/datastore)
- [Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Save data in a local database using Room](https://developer.android.com/training/data-storage/room)
