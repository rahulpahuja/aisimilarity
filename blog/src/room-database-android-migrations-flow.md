---
title: "Room on Android: Flow queries, relations and safe migrations"
slug: room-database-android-migrations-flow
date: 2026-11-02
order: 11
category: "Data & Networking"
tags: [room, sqlite, flow, migrations, ksp]
summary: "Set up Room with KSP, expose Flow queries, model relations and transactions, and ship schema changes without crashing or wiping user data."
---

Most Room bugs reach production in one of two ways: a database call on the main thread, or a schema change shipped without a migration. The first is mostly prevented by Room itself. The second is not, and it is the one that costs users their data. This post covers a Room setup that stays reactive with `Flow`, models relations correctly, and treats the schema as a versioned contract that you test.

## TL;DR

- Use KSP (not kapt) for `room-compiler`, and let the Room Gradle plugin export schemas to a directory you commit.
- Return `Flow` from read queries and make writes `suspend`. A `Flow` query re-emits whenever any table it reads from changes.
- Relations (`@Relation`) are multiple queries: wrap them in `@Transaction`.
- Prefer `@AutoMigration` for additive and rename changes, write a manual `Migration` for everything else, and test each one with `MigrationTestHelper`.
- Never ship `fallbackToDestructiveMigration()` in a release build unless losing the data is an explicit product decision.

## Setup with KSP and schema export

Room's annotation processor runs through KSP. Apply the KSP and Room plugins and point the schema directory at a folder under version control.

```kotlin
// app/build.gradle.kts
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.androidx.room)
}

room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    androidTestImplementation(libs.androidx.room.testing)
}
```

The version catalog maps those aliases to `androidx.room:room-runtime`, `androidx.room:room-ktx`, `androidx.room:room-compiler` and `androidx.room:room-testing`. The Room Gradle plugin is `androidx.room`, and KSP is `com.google.devtools.ksp`. Check the release notes for your Room version to confirm whether `room-ktx` is still a separate artifact for your setup.

Commit the generated `schemas/<db>/<version>.json` files. They are the only record of what each shipped version looked like, and both auto-migrations and migration tests read them.

## Entities, DAOs and Flow-returning queries

```kotlin
@Entity(tableName = "author")
data class AuthorEntity(
    @PrimaryKey val id: Long,
    val name: String,
)

@Entity(
    tableName = "book",
    foreignKeys = [ForeignKey(
        entity = AuthorEntity::class,
        parentColumns = ["id"],
        childColumns = ["authorId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("authorId")],
)
data class BookEntity(
    @PrimaryKey val id: Long,
    val authorId: Long,
    val title: String,
)

@Dao
interface LibraryDao {
    @Query("SELECT * FROM book ORDER BY title")
    fun observeBooks(): Flow<List<BookEntity>>

    @Upsert
    suspend fun upsertBooks(books: List<BookEntity>)

    @Query("DELETE FROM book WHERE id = :id")
    suspend fun deleteBook(id: Long)
}
```

Two behaviours matter in practice. First, `suspend` DAO functions and `Flow` queries are main-safe: Room runs them on its own executor, so you do not need `withContext(Dispatchers.IO)`. Second, invalidation is table-level, not row-level. Any write to `book` re-runs `observeBooks()` and re-emits, even if no row in your result changed. If downstream work is expensive, add `distinctUntilChanged()` after mapping to your domain model.

Index every foreign key column. Without the index on `authorId`, a cascading delete on `author` has to scan `book`.

## Relations and transactions

A one-to-many read is a parent plus its children. `@Relation` expresses that, but Room executes it as two queries, so it must be atomic.

```kotlin
data class AuthorWithBooks(
    @Embedded val author: AuthorEntity,
    @Relation(parentColumn = "id", entityColumn = "authorId")
    val books: List<BookEntity>,
)

@Dao
interface AuthorDao {
    @Transaction
    @Query("SELECT * FROM author WHERE id = :id")
    fun observeAuthorWithBooks(id: Long): Flow<AuthorWithBooks?>
}
```

For multi-step writes, use `@Transaction` on a DAO method that calls other DAO functions, or `database.withTransaction { ... }` from `room-ktx` when the steps span DAOs. Without a transaction, an app killed between steps leaves half an update on disk.

## Migrations: auto, manual, and tested

Every change to an entity needs a version bump on `@Database`. Start with auto-migrations, which Room generates by diffing two exported schema files.

```kotlin
@Database(
    entities = [AuthorEntity::class, BookEntity::class],
    version = 4, // 3 -> 4 is the manual migration below
    exportSchema = true,
    autoMigrations = [
        AutoMigration(from = 1, to = 2),
        AutoMigration(from = 2, to = 3, spec = LibraryDatabase.Spec2To3::class),
    ],
)
abstract class LibraryDatabase : RoomDatabase() {
    abstract fun libraryDao(): LibraryDao
    abstract fun authorDao(): AuthorDao

    @RenameColumn(tableName = "book", fromColumnName = "name", toColumnName = "title")
    class Spec2To3 : AutoMigrationSpec
}
```

Adding a column with a default, adding a table, and (with a spec) renaming or deleting columns and tables are all handled. Anything that needs data transformation, such as splitting a column or backfilling from another table, needs a manual `Migration`. Here `BookEntity` has gained `@ColumnInfo(defaultValue = "''") val isbn: String = ""`, and the migration must produce exactly the column Room expects:

```kotlin
val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE book ADD COLUMN isbn TEXT NOT NULL DEFAULT ''")
    }
}

Room.databaseBuilder(context, LibraryDatabase::class.java, "library.db")
    .addMigrations(MIGRATION_3_4)
    .build()
```

Test each migration against the exported schema. This is an instrumented test, because it needs a real SQLite.

```kotlin
@RunWith(AndroidJUnit4::class)
class LibraryMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        LibraryDatabase::class.java,
    )

    @Test
    fun migrate3To4_keepsRowsAndAddsIsbn() {
        helper.createDatabase("test.db", 3).apply {
            execSQL("INSERT INTO author(id, name) VALUES (1, 'Ada')")
            execSQL("INSERT INTO book(id, authorId, title) VALUES (1, 1, 'Notes')")
            close()
        }

        val db = helper.runMigrationsAndValidate("test.db", 4, true, MIGRATION_3_4)

        db.query("SELECT title, isbn FROM book").use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals("Notes", cursor.getString(0))
            assertEquals("", cursor.getString(1))
        }
    }
}
```

`runMigrationsAndValidate` also compares the resulting schema to the exported JSON for the target version, which catches a migration that forgot an index or got a column's nullability wrong. The Room Gradle plugin wires the schema directory into the test assets for you. If the helper cannot find a schema file, check the Room release notes for your version.

## Common mistakes

- **Forgetting `exportSchema` or not committing the JSON.** Auto-migrations fail to build and migration tests cannot run. Commit `schemas/`.
- **Using `fallbackToDestructiveMigration()` as a safety net.** A missing migration then silently deletes user data instead of crashing in testing. Use it only for caches you can rebuild, and prefer the scoped variants over the blanket one.
- **Changing an entity without bumping the version.** Debug builds crash with an identity-hash mismatch on the next launch; worse, a reused version number skips your migration for installed users.
- **`@Relation` queries without `@Transaction`.** A concurrent write between the parent and child queries returns inconsistent data. Add the annotation.
- **Collecting a `Flow` query with `GlobalScope` or in a long-lived scope.** The query keeps observing forever. Collect with `repeatOnLifecycle` or `collectAsStateWithLifecycle`, or convert with `stateIn(..., SharingStarted.WhileSubscribed(5_000), ...)`.
- **Putting large blobs in rows.** Cursor windows are small and big rows trigger `SQLiteBlobTooBigException`. Store files on disk and keep the path.

## If you know iOS

Room's closest counterpart is SwiftData (or Core Data underneath it): `@Entity` maps to a `@Model` class, and `@Query` in a SwiftUI view plays the role of a DAO `Flow` that re-renders on change. Schema evolution is explicit on both sides: SwiftData uses `VersionedSchema` and `SchemaMigrationPlan`, where Room uses versioned schemas plus `Migration` objects. See the Equivalents page for the wider persistence mapping.

## Further reading

- [Save data in a local database using Room](https://developer.android.com/training/data-storage/room)
- [Migrate your Room database](https://developer.android.com/training/data-storage/room/migrating-db-versions)
- [Define relationships between objects](https://developer.android.com/training/data-storage/room/relationships)
- [Migrate from kapt to KSP](https://developer.android.com/build/migrate-to-ksp)
