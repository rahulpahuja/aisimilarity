---
title: "Android testing: ViewModels, Turbine and Compose UI tests"
slug: android-testing-viewmodel-turbine-compose
date: 2026-11-02
order: 15
category: "Data & Networking"
tags: [testing, viewmodel, turbine, coroutines, compose]
summary: "A practical Android test strategy: runTest and TestDispatcher for ViewModels, Turbine for Flows, fakes over mocks, and Compose UI tests with semantics."
---

Android test suites usually fail in one of two ways: too many slow instrumented tests that flake, or JVM tests so coupled to mocks that every refactor breaks them. The fix is the same: push logic into plain Kotlin, test it fast on the JVM with fakes and virtual time, and keep a thin layer of UI tests for what only a real UI can verify. This post shows each layer with working code.

## TL;DR

- Most tests should be local JVM tests of ViewModels, use cases and mappers. Few should be instrumented UI tests.
- Replace `Dispatchers.Main` with a `TestDispatcher` and run coroutine tests inside `runTest`; never use real delays.
- Test `Flow` and `StateFlow` with Turbine: assert the exact sequence of emissions.
- Prefer hand-written fakes over mocks for repositories. Fakes verify behavior; mocks verify calls.
- Test Compose UI through semantics (text, content description, test tags), against stateless composables you can feed state to.

## The pyramid, applied

| Layer | Runs on | What it covers | Speed |
| --- | --- | --- | --- |
| Unit | JVM | ViewModels, use cases, mappers, reducers | fastest |
| Integration | JVM with Robolectric, or device | Room DAOs, WorkManager, repository plus real database | moderate |
| UI | Device/emulator (or Robolectric) | Composables, navigation wiring, accessibility semantics | slowest |

The shape follows from where bugs are cheap to catch. Structure the app so that decisions live in the bottom layer, and UI tests only confirm the wiring.

## Testing a ViewModel

Here is the ViewModel under test. It depends on an interface, so a fake can stand in for the network.

```kotlin
data class ProfileUiState(
    val isLoading: Boolean = true,
    val name: String? = null,
    val error: String? = null,
)

interface ProfileRepository {
    suspend fun load(id: String): Result<String>
}

class ProfileViewModel(
    private val repository: ProfileRepository,
    private val userId: String,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init { load() }

    fun onRetry() = load()

    private fun load() {
        viewModelScope.launch {
            _uiState.value = ProfileUiState(isLoading = true)
            repository.load(userId)
                .onSuccess { _uiState.value = ProfileUiState(isLoading = false, name = it) }
                .onFailure { _uiState.value = ProfileUiState(isLoading = false, error = "Could not load") }
        }
    }
}
```

`viewModelScope` uses `Dispatchers.Main.immediate`, which does not exist in a JVM test. Replace it before each test and reset it after. With JUnit 5, that is an extension. (AGP does not run JUnit 5 natively; the community `de.mannodermaus.android-junit5` plugin does. The same tests work on JUnit 4 with a rule instead of an extension.)

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherExtension(
    private val dispatcher: TestDispatcher = StandardTestDispatcher(),
) : BeforeEachCallback, AfterEachCallback {
    override fun beforeEach(context: ExtensionContext) = Dispatchers.setMain(dispatcher)
    override fun afterEach(context: ExtensionContext) = Dispatchers.resetMain()
}
```

The fake is a few lines, and it is deterministic:

```kotlin
class FakeProfileRepository : ProfileRepository {
    var result: Result<String> = Result.success("Ada")
    val requestedIds = mutableListOf<String>()

    override suspend fun load(id: String): Result<String> {
        requestedIds += id
        return result
    }
}
```

Now the tests. They follow the arrange, act, assert layout, name the subject `sut`, and use backtick names that read as sentences.

```kotlin
class ProfileViewModelTest {

    @JvmField
    @RegisterExtension
    val mainDispatcher = MainDispatcherExtension()

    private val repository = FakeProfileRepository()

    @Test
    fun `When repository succeeds then state goes from loading to loaded`() = runTest {
        // create objects
        repository.result = Result.success("Ada")
        val sut = ProfileViewModel(repository, userId = "42")
        val expected = listOf(
            ProfileUiState(isLoading = true),
            ProfileUiState(isLoading = false, name = "Ada"),
        )

        // execute and assert
        sut.uiState.test {
            val actual = listOf(awaitItem(), awaitItem())
            assertEquals(expected = expected, actual = actual)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `When retry follows a failure then state recovers`() = runTest {
        repository.result = Result.failure(IOException("offline"))
        val sut = ProfileViewModel(repository, userId = "42")

        sut.uiState.test {
            assertEquals(expected = ProfileUiState(isLoading = true), actual = awaitItem())
            assertEquals(
                expected = ProfileUiState(isLoading = false, error = "Could not load"),
                actual = awaitItem(),
            )

            repository.result = Result.success("Ada")
            sut.onRetry()

            assertEquals(expected = ProfileUiState(isLoading = true), actual = awaitItem())
            assertEquals(
                expected = ProfileUiState(isLoading = false, name = "Ada"),
                actual = awaitItem(),
            )
            assertEquals(expected = listOf("42", "42"), actual = repository.requestedIds)
        }
    }
}
```

Three details make these tests honest:

- `StandardTestDispatcher` does not run launched coroutines until the test yields. That is why the `isLoading = true` state is observable. With `UnconfinedTestDispatcher`, `StateFlow` conflation would hide it and you would only see the final state. Pick the dispatcher that matches the contract you want to assert.
- `runTest` picks up the scheduler from the dispatcher you set as Main, so `viewModelScope` and the test body share one virtual clock. Use `advanceUntilIdle()` or `advanceTimeBy()` for delays; `delay(5_000)` costs nothing in virtual time.
- Turbine's `awaitItem()` fails the test on timeout and on unconsumed events at the end, so a surprise emission is a failure, not silence. Use `awaitComplete()`, `awaitError()` and `expectNoEvents()` for the rest of the contract.

## Fakes over mocks

A mock records calls and returns canned values, so a test says "`load` was called with 42". A fake is a working, simplified implementation, so a test says "the screen shows Ada". When you refactor the ViewModel to call `load` twice or batch calls, the mock test breaks and the fake test does not, because the behaviour did not change.

Use mocks (MockK or Mockito-Kotlin, consistently within one project) for things that are hard to fake or where the interaction *is* the behaviour, such as "analytics event was sent". Keep fakes next to the interface they implement, in a shared `testFixtures` or test-support module so every module reuses them. A fake that exposes a `MutableSharedFlow` or `MutableStateFlow` lets a test drive a repository's stream:

```kotlin
class FakeArticleRepository : ArticleRepository {
    val articles = MutableStateFlow<List<Article>>(emptyList())
    override fun observeArticles(): Flow<List<Article>> = articles
}
```

## Compose UI tests

Compose tests run on a device or emulator, or on the JVM with Robolectric if you want faster feedback; check the Compose testing docs for the Robolectric setup. The rule is a JUnit 4 `TestRule`, so UI tests use JUnit 4 even if your JVM tests use JUnit 5.

```kotlin
// build.gradle.kts
// androidTestImplementation: androidx.compose.ui:ui-test-junit4
// debugImplementation:       androidx.compose.ui:ui-test-manifest
```

Test a stateless composable: state in, events out. No ViewModel, no repository, no navigation.

```kotlin
@Composable
fun ProfileContent(state: ProfileUiState, onRetry: () -> Unit) {
    when {
        state.isLoading -> CircularProgressIndicator(Modifier.testTag("loading"))
        state.error != null -> Column {
            Text(state.error)
            Button(onClick = onRetry) { Text("Retry") }
        }
        else -> Text(state.name.orEmpty())
    }
}

class ProfileContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun errorState_showsMessageAndRetryInvokesCallback() {
        var retries = 0
        composeRule.setContent {
            ProfileContent(
                state = ProfileUiState(isLoading = false, error = "Could not load"),
                onRetry = { retries++ },
            )
        }

        composeRule.onNodeWithText("Could not load").assertIsDisplayed()
        composeRule.onNode(hasText("Retry") and hasClickAction()).performClick()

        assertEquals(expected = 1, actual = retries)
    }

    @Test
    fun loadingState_showsProgress() {
        composeRule.setContent { ProfileContent(ProfileUiState(isLoading = true), onRetry = {}) }

        composeRule.onNodeWithTag("loading").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertDoesNotExist()
    }
}
```

Finders query the *semantics tree*, not views: `onNodeWithText`, `onNodeWithContentDescription`, `onNodeWithTag`, and combinators like `hasText(...) and hasClickAction()`. Prefer text and content description first, because they also exercise accessibility; fall back to `testTag` for nodes with neither. When a `Button` merges its children, a text finder still finds the merged node; pass `useUnmergedTree = true` if you must target a child. When a query fails, `composeRule.onRoot().printToLog("TAG")` prints the tree.

The test clock is virtual too. Compose idles automatically between actions, so avoid `Thread.sleep`; for work driven by external state use `composeRule.waitUntil { ... }`, and `composeRule.mainClock` to control animations.

## Common mistakes

- **Forgetting `Dispatchers.resetMain()`.** The test dispatcher leaks into the next test and failures depend on test order. Use the extension or rule.
- **Using `runBlocking` or `Thread.sleep` in tests.** They are slow and flaky. Use `runTest` and virtual time.
- **Collecting a flow with `launch` and never cancelling it.** `runTest` fails with an uncompleted coroutine or hangs. Use Turbine, or `backgroundScope.launch` for helpers.
- **Asserting only the final state.** A bug that flashes a wrong intermediate state passes. Assert the sequence with Turbine when the sequence is part of the UX.
- **Mocking everything.** The test mirrors the implementation and breaks on every refactor. Fake the boundary, assert outcomes.
- **Testing a stateful screen end to end for every case.** It is slow and brittle. Test the stateless composable per state, and one or two integration tests for wiring.

## If you know iOS

The structure carries over directly: XCTest or Swift Testing for unit tests, and XCUITest for UI tests. `@MainActor` view models are tested with `async` test functions, where Android uses `runTest`, and fakes beat mocks for the same reasons. `accessibilityIdentifier` is the counterpart of `testTag`, and querying by label or text is the counterpart of semantics finders. See the Equivalents page for the testing tools mapping.

## Further reading

- [Test coroutines on Android](https://developer.android.com/kotlin/coroutines/test)
- [Test your Compose layout](https://developer.android.com/develop/ui/compose/testing)
- [Turbine](https://github.com/cashapp/turbine)
- [Testing Kotlin coroutines (kotlinx.coroutines-test)](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/)
