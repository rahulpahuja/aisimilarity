---
title: "Hilt on Android: A Practical Guide, with Koin and Manual DI Compared"
slug: hilt-dependency-injection-android-guide
date: 2026-11-02
order: 9
category: "Kotlin & Architecture"
tags: [hilt, dagger, dependency-injection, koin, testing]
summary: "Hilt setup, modules, scopes, @HiltViewModel, assisted injection and test replacement, with honest trade-offs against Koin and hand-written DI."
---

Once a ViewModel needs a repository, and the repository needs an API client, a DAO and a dispatcher, somebody has to construct that chain, share the expensive parts, and swap them out in tests. You can do it by hand, with a service locator, or with a dependency injection framework. Hilt is Google's answer for Android; this post shows the parts you will actually use, then compares it fairly against Koin and manual DI.

## TL;DR

- Hilt is a layer over Dagger that predefines Android components and entry points. The dependency graph is validated at compile time, so a missing binding is a build error rather than a runtime crash.
- Setup is `@HiltAndroidApp` on your `Application`, `@AndroidEntryPoint` on Activities and Fragments, and `@Inject constructor` on your own classes.
- Use `@Binds` to map an interface to an implementation and `@Provides` for things you cannot annotate (OkHttp, Room). Prefer `@Binds`.
- Scope sparingly: unscoped bindings create a new instance per injection, which is usually what you want.
- Tests replace modules with `@TestInstallIn` or individual values with `@BindValue`.

## Setup

Hilt needs its Gradle plugin, a KSP (or kapt) compiler, and the runtime. Plugin id is `com.google.dagger.hilt.android`; the artifacts are `com.google.dagger:hilt-android` and `com.google.dagger:hilt-android-compiler`. Check the Hilt release notes for the current version.

```toml
[versions]
hilt = "x.y.z"        # take the latest stable from the Hilt release notes
ksp = "x.y.z"         # must match your Kotlin version, see the KSP release notes

[libraries]
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-android-compiler", version.ref = "hilt" }
hilt-testing = { group = "com.google.dagger", name = "hilt-android-testing", version.ref = "hilt" }
hilt-lifecycle-viewmodel-compose = { group = "androidx.hilt", name = "hilt-lifecycle-viewmodel-compose", version = "x.y.z" }

[plugins]
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
```

```kotlin
// app/build.gradle.kts
plugins {
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

dependencies {
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.lifecycle.viewmodel.compose)

    androidTestImplementation(libs.hilt.testing)
    kspAndroidTest(libs.hilt.compiler)
}
```

Then the three entry annotations:

```kotlin
@HiltAndroidApp
class App : Application()

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    // setContent { ... } and hiltViewModel() work from here
}
```

`@HiltAndroidApp` triggers generation of the root component, so it must be on your `Application` class, which you register in the manifest as usual.

## Bindings: @Inject, @Binds, @Provides

If you own the class and it has a single obvious constructor, annotate it and you are done:

```kotlin
class DefaultUserRepository @Inject constructor(
    private val api: UserApi,
    private val dao: UserDao,
    @IoDispatcher private val io: CoroutineDispatcher,
) : UserRepository
```

When consumers depend on an interface, tell Hilt which implementation to use with `@Binds` in an abstract module. When you do not own the class, or building it needs code, use `@Provides` in an `object` module. Qualifiers distinguish two bindings of the same type.

```kotlin
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    @Singleton
    abstract fun bindUserRepository(impl: DefaultUserRepository): UserRepository
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @IoDispatcher
    fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO

    @Provides
    @Singleton
    fun provideOkHttp(): OkHttpClient = OkHttpClient.Builder().build()
}
```

`@Binds` is the idiomatic way to map an interface to an implementation: it is a declaration with no method body, so there is nothing to keep in sync with the constructor. Injecting dispatchers through a qualifier is what makes the coroutine code from the structured-concurrency post testable.

## Components and scopes

`@InstallIn` picks the component whose lifetime the bindings live in, and a scope annotation caches one instance for that lifetime.

| Component | Scope | Lives from / until |
|---|---|---|
| `SingletonComponent` | `@Singleton` | Application created / process ends |
| `ActivityRetainedComponent` | `@ActivityRetainedScoped` | First Activity create / last destroy, survives rotation |
| `ViewModelComponent` | `@ViewModelScoped` | ViewModel created / cleared |
| `ActivityComponent` | `@ActivityScoped` | Activity create / destroy |
| `FragmentComponent` | `@FragmentScoped` | Fragment attach / destroy |

Hilt also has view and service components. Rules of thumb:

- Scope only what must be shared or is expensive: the HTTP client, the database, caches, repositories holding in-memory state.
- A binding can only depend on bindings in the same or a longer-lived component. A `@Singleton` cannot take an `Activity`.
- Scoping holds the instance for the component's life, which is memory. Unscoped is the default for a reason.

## ViewModels and assisted injection

`@HiltViewModel` plus `@Inject constructor` is the whole story for a normal ViewModel. `SavedStateHandle` is available for injection automatically.

```kotlin
@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repository: UserRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel()

@Composable
fun ProfileRoute(viewModel: ProfileViewModel = hiltViewModel()) { /* ... */ }
```

`hiltViewModel()` comes from `androidx.hilt:hilt-lifecycle-viewmodel-compose` (package `androidx.hilt.lifecycle.viewmodel.compose`). Older tutorials import it from `androidx.hilt:hilt-navigation-compose`; those overloads are deprecated in favour of this package in current releases. In Views code, `by viewModels()` in an `@AndroidEntryPoint` Activity or Fragment does the same job.

When a ViewModel needs a runtime value that is not in the graph, use assisted injection. For navigation arguments, `SavedStateHandle` is simpler and also survives process death; reach for assisted injection when the value is not an argument.

```kotlin
@HiltViewModel(assistedFactory = DetailViewModel.Factory::class)
class DetailViewModel @AssistedInject constructor(
    @Assisted private val itemId: String,
    private val repository: ItemRepository,
) : ViewModel() {

    @AssistedFactory
    interface Factory {
        fun create(itemId: String): DetailViewModel
    }
}

@Composable
fun DetailRoute(itemId: String) {
    val viewModel = hiltViewModel<DetailViewModel, DetailViewModel.Factory>(
        creationCallback = { factory -> factory.create(itemId) }
    )
    // ...
}
```

## Testing with Hilt

Instrumented tests run in a generated `HiltTestApplication`, which needs a custom runner set as `testInstrumentationRunner` in your Gradle config.

```kotlin
class HiltTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader?, name: String?, context: Context?): Application =
        super.newApplication(cl, HiltTestApplication::class.java.name, context)
}
```

To replace a production module across all tests, use `@TestInstallIn`. To swap a single value in one test, use `@BindValue`.

```kotlin
@Singleton
class FakeUserRepository @Inject constructor() : UserRepository { /* in-memory */ }

@Module
@TestInstallIn(
    components = [SingletonComponent::class],
    replaces = [RepositoryModule::class],
)
abstract class FakeRepositoryModule {
    @Binds
    abstract fun bindRepository(fake: FakeUserRepository): UserRepository
}

@HiltAndroidTest
class ProfileScreenTest {
    @get:Rule(order = 0) val hiltRule = HiltAndroidRule(this)
    @get:Rule(order = 1) val composeRule = createAndroidComposeRule<MainActivity>()

    @Inject lateinit var repository: UserRepository

    @Before fun setUp() = hiltRule.inject()
}
```

Plain JVM unit tests of a ViewModel need none of this: you pass fakes to the constructor. Constructor injection is what makes that possible, which is a benefit of DI in general rather than of Hilt.

## Hilt, Koin, or manual DI

| | Hilt | Koin | Manual |
|---|---|---|---|
| Graph validation | Compile time | Runtime (Koin ships a verification utility for tests) | Compile time, by construction |
| Code generation | Yes (KSP or kapt), adds build time | No | No |
| Platform | Android only | Kotlin Multiplatform supported | Anything |
| Learning curve | Steepest: components, scopes, error messages | Gentle: a Kotlin DSL | None, until the graph grows |
| Android lifecycles | First-class scopes | Scopes available, less prescribed | You write them |

My read of the trade-offs:

- **Hilt** is the best default for a team-sized, Android-only app, and it is the option Android's own documentation recommends. You pay in build time, annotation-processor error messages, and rules about what can be injected where.
- **Koin** is attractive if you share code in a Kotlin Multiplatform module or want zero code generation. The cost is that a missing or mis-typed definition is found when the object is resolved, so you need a test that verifies the graph.
- **Manual DI** (an `AppContainer` created in `Application`, plus hand-written ViewModel factories) is entirely adequate for small apps and libraries, and it teaches you what the frameworks automate. It stops scaling once you hand-write scoping, factories and test overrides for dozens of classes.

## Common mistakes

- **Forgetting `@AndroidEntryPoint` on a host class.** Consequence: a runtime error when a Fragment or Activity tries to use Hilt. Note that if a Fragment is annotated, its host Activity must be too. Fix: annotate every Android class that injects or hosts one that does.
- **Scoping everything `@Singleton`.** Consequence: memory held for the process lifetime and hidden shared state. Fix: scope only shared or expensive objects.
- **Using `@Provides` for a class you own.** Consequence: extra boilerplate and no benefit. Fix: `@Inject constructor`, and `@Binds` for the interface.
- **Injecting `Context` carelessly.** Consequence: an Activity context in a long-lived binding is a leak. Fix: use `@ApplicationContext` for long-lived objects.
- **Field-injecting into your own non-Android classes.** Consequence: untestable hidden dependencies. Fix: constructor injection; keep field injection for framework classes only.
- **Running `@HiltAndroidTest` tests with the default instrumentation runner.** Consequence: the test uses your real `Application` and the graph is not replaceable, so the test fails at startup. Fix: set the custom runner above as `testInstrumentationRunner`.

## If you know iOS

There is no dominant DI framework on iOS. The usual approach is constructor injection with protocols, plus SwiftUI's `@Environment` (or `.environmentObject`) to pass shared objects down the view tree, which is closer to a scoped service locator than to Hilt's compile-time graph. Third-party containers exist but are far less standard than Hilt is on Android. If you are porting a test strategy: protocol plus fake in Swift maps to interface plus `@TestInstallIn` here. See the Equivalents page.

## Further reading

- [Dependency injection with Hilt](https://developer.android.com/training/dependency-injection/hilt-android)
- [Hilt testing guide](https://developer.android.com/training/dependency-injection/hilt-testing)
- [Manual dependency injection](https://developer.android.com/training/dependency-injection/manual)
- [Hilt on dagger.dev](https://dagger.dev/hilt/)
