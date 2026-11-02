---
title: "Retrofit, OkHttp and kotlinx.serialization: a modern networking stack"
slug: retrofit-okhttp-kotlinx-serialization
date: 2026-11-02
order: 14
category: "Data & Networking"
tags: [retrofit, okhttp, kotlinx-serialization, networking, security]
summary: "Wire Retrofit, OkHttp and kotlinx.serialization together: suspend APIs, interceptors, timeouts, a Result type for errors, caching and safe logging."
---

The default Android networking stack in 2026 is still Retrofit on top of OkHttp, with kotlinx.serialization replacing Gson and Moshi in new Kotlin code. The pieces fit together well, but the defaults leave three decisions to you: how failures are represented, what gets logged, and what the app trusts on the wire. This post builds a small client and makes those decisions explicit.

## TL;DR

- Retrofit declares the API, OkHttp does the HTTP, and `converter-kotlinx-serialization` turns JSON into `@Serializable` classes.
- Declare endpoints as `suspend` functions. Retrofit runs them off the main thread, and they throw `IOException` for network failure and `HttpException` for non-2xx responses.
- Convert exceptions into a sealed result type at one boundary so ViewModels never see raw exceptions.
- Set explicit timeouts, add auth with an interceptor, and never log bodies or `Authorization` headers in release builds.
- Cleartext HTTP is blocked by default on modern Android; keep it that way and use the network security config for exceptions and pinning.

## Dependencies and client setup

```kotlin
// build.gradle.kts
plugins {
    alias(libs.plugins.kotlin.serialization) // org.jetbrains.kotlin.plugin.serialization
}

dependencies {
    implementation(libs.retrofit)                         // com.squareup.retrofit2:retrofit
    implementation(libs.retrofit.kotlinx.serialization)   // com.squareup.retrofit2:converter-kotlinx-serialization
    implementation(libs.okhttp)                           // com.squareup.okhttp3:okhttp
    debugImplementation(libs.okhttp.logging)              // com.squareup.okhttp3:logging-interceptor
    implementation(libs.kotlinx.serialization.json)       // org.jetbrains.kotlinx:kotlinx-serialization-json
}
```

Putting the logging interceptor in `debugImplementation` means release builds cannot reference it at all, which is a stronger guarantee than a runtime `if`.

```kotlin
private val json = Json {
    ignoreUnknownKeys = true   // server may add fields; do not crash
    coerceInputValues = true   // null for a non-null property with a default -> default
}

fun provideRetrofit(client: OkHttpClient): Retrofit =
    Retrofit.Builder()
        .baseUrl("https://api.example.com/v1/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
```

`ignoreUnknownKeys` is the setting that keeps old app versions working when the backend adds a field. The base URL must end with `/`.

## Suspend interface methods

```kotlin
@Serializable
data class CreateArticleRequest(val title: String)

@Serializable
data class ArticleDto(
    val id: Long,
    val title: String,
    @SerialName("published_at") val publishedAt: String,
)

interface ArticleApi {
    @GET("articles")
    suspend fun articles(@Query("page") page: Int): List<ArticleDto>

    @GET("articles/{id}")
    suspend fun article(@Path("id") id: Long): Response<ArticleDto>

    @POST("articles")
    suspend fun create(@Body body: CreateArticleRequest): ArticleDto
}

val api: ArticleApi = retrofit.create(ArticleApi::class.java)
```

Return the body type directly for the simple case. Return `Response<T>` when you need status code, headers, or the error body. Either way you call it from a coroutine on any dispatcher; Retrofit uses OkHttp's own async machinery, so it does not block the calling thread.

Keep DTOs (wire format) separate from domain models. A `@SerialName` rename on the server then touches one mapper, not the UI.

## Modelling errors with a result type

With a plain `T` return, a 404 throws `HttpException`, a dropped connection throws `IOException`, and a malformed body throws `SerializationException`. Catch them once, at the data-layer boundary.

```kotlin
sealed interface ApiResult<out T> {
    data class Success<T>(val value: T) : ApiResult<T>
    data class HttpError(val code: Int, val message: String?) : ApiResult<Nothing>
    data class NetworkError(val cause: IOException) : ApiResult<Nothing>
    data class Unexpected(val cause: Throwable) : ApiResult<Nothing>
}

suspend fun <T> apiCall(block: suspend () -> T): ApiResult<T> =
    try {
        ApiResult.Success(block())
    } catch (e: HttpException) {
        ApiResult.HttpError(e.code(), e.message())
    } catch (e: IOException) {
        ApiResult.NetworkError(e)
    } catch (e: SerializationException) {
        ApiResult.Unexpected(e)
    }
    // CancellationException is not caught, so structured concurrency still works
```

`HttpException` is not an `IOException`, so the catch clauses do not shadow each other. The important detail is what is *not* caught: catching `Exception` or `Throwable` would swallow `CancellationException` and break coroutine cancellation. Usage:

```kotlin
suspend fun loadArticles(page: Int): ApiResult<List<Article>> =
    when (val result = apiCall { api.articles(page) }) {
        is ApiResult.Success -> ApiResult.Success(result.value.map(ArticleDto::toDomain))
        is ApiResult.HttpError -> result
        is ApiResult.NetworkError -> result
        is ApiResult.Unexpected -> result
    }
```

Map `ApiResult` to UI state in the ViewModel: `NetworkError` becomes "check your connection, retry", a 401 becomes a sign-out, a 5xx becomes a generic failure.

## OkHttp: interceptors, timeouts, cache

```kotlin
fun provideOkHttpClient(context: Context, tokenProvider: TokenProvider): OkHttpClient =
    OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .cache(Cache(File(context.cacheDir, "http"), 10L * 1024 * 1024))
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .header("Authorization", "Bearer ${tokenProvider.accessToken()}")
                .build()
            chain.proceed(request)
        }
        .build()
```

Notes:

- OkHttp's defaults are 10 seconds each for connect, read and write, and no overall `callTimeout`. `readTimeout` is per read, not per response, so a slow trickle never trips it. Set `callTimeout` if you need a hard ceiling.
- Application interceptors (`addInterceptor`) see the request you built and run once per call. Network interceptors (`addNetworkInterceptor`) run for each network hop, including redirects, and are skipped when the response comes from the cache. Use application interceptors for headers and logging unless you need wire-level behaviour.
- For a 401 refresh flow, implement `Authenticator` rather than retrying inside an interceptor; OkHttp serialises it and avoids loops.
- The HTTP `Cache` honours `Cache-Control` and `ETag` headers sent by the server for GET requests. If the server sends none, you get no caching, and rewriting headers in an interceptor to force it is usually a smell. For data the app must show offline, make Room the source of truth and treat HTTP as a refresh mechanism.

### Logging without leaking secrets

```kotlin
fun OkHttpClient.Builder.withDebugLogging(): OkHttpClient.Builder = apply {
    if (BuildConfig.DEBUG) {
        addInterceptor(
            HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
                redactHeader("Authorization")
                redactHeader("Cookie")
            }
        )
    }
}
```

`BODY` logs response payloads, which can include personal data and tokens. Even in debug, use `redactHeader`, and use `Level.BASIC` if you only need URLs and codes. Logcat output ends up in bug reports and attached log files.

## Network security config

The network security config is an XML file referenced from the manifest. At a high level it controls cleartext traffic, which certificate authorities you trust, and optional pinning.

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

```xml
<application android:networkSecurityConfig="@xml/network_security_config" ... />
```

Cleartext is already off by default for apps targeting Android 9 and higher, so the explicit setting documents intent. Put exceptions, such as a `domain-config` for a local dev server or extra trust anchors for debug builds, in a debug-only source set so they cannot ship. Certificate pinning (`pin-set` in the config, or `CertificatePinner` in OkHttp) protects against a rogue CA but can lock users out when a certificate rotates; pin backup keys and set an expiration, or decide not to pin.

## Common mistakes

- **Catching `Exception` in a suspend wrapper.** It swallows `CancellationException`, so cancelled screens keep working and leak. Catch specific types.
- **Logging `Level.BODY` unconditionally.** Tokens and personal data land in Logcat and crash reports. Gate by build type and redact headers.
- **Leaving `ignoreUnknownKeys` off.** A new server field crashes every installed app version with `SerializationException`. Turn it on.
- **Relying on default timeouts.** There is no overall call limit, so a stalled server can hold a spinner for a long time. Set `callTimeout`.
- **Treating every `HttpException` the same.** A 401 should trigger re-authentication, a 429 or 503 may deserve a retry with backoff, and a 400 never will. Branch on `code`.
- **Allowing cleartext globally to fix a dev problem.** It ships to production. Scope exceptions to debug.

## If you know iOS

Retrofit plus OkHttp corresponds to `URLSession`, with `Codable` and `JSONDecoder` in the role of the converter. Interceptors have no single built-in counterpart; on iOS you wrap `URLSession` calls or use a `URLProtocol`. App Transport Security (ATS) is the cousin of the network security config: both block cleartext by default and require explicit exceptions. See the Equivalents page for the networking mapping.

## Further reading

- [Retrofit](https://lysine.dev/retrofit/)
- [OkHttp](https://lysine.dev/okhttp/)
- [Network security configuration](https://developer.android.com/privacy-and-security/security-config)
- [Kotlin serialization guide](https://kotlinlang.org/docs/serialization.html)
