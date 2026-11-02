# AI Similarity — Cross-Platform Mobile Dictionary

**Know it on Android? Find it on iOS, Flutter, React Native, .NET MAUI and Ionic.**
A static site (no build step to browse it) that maps components, libraries and platform concepts across mobile frameworks.

## What's here

| Section | Path | What it answers |
|---|---|---|
| Home | `index.html` | One search box across everything below, plus the knowledge quiz |
| Components | `components/` | "What is `LazyColumn` / `RecyclerView` on the other platforms?" Modern (Compose ↔ SwiftUI) and classic (Views ↔ UIKit) |
| Libraries | `libraries/` | "I use Coil / Retrofit / Room on Android, what do I use on iOS, with the install line?" UI component libraries and non-UI dependencies |
| Equivalents | `equivalents/` | "What is an Activity / Intent / WorkManager / Keystore / Gradle called on iOS?" Concepts and tooling |
| Blog | `blog/` | Android guides, each with an "If you know iOS" section |
| Extras | `iqlist.html`, `droid.html`, `squircle.html`, `compose/compose.html` | Interview topics, two games, the original tabbed Compose view |

Every list page supports `/` to focus search and shareable URLs (`?q=…`, plus page-specific filters).

## Data (the sources of truth)

| File | Contents |
|---|---|
| `compose/<category>.json` (22 files) | Modern UI components: Compose, SwiftUI, React Native, Flutter, MAUI, Ionic |
| `data/components-classic.json` | Classic Views/UIKit mappings (migrated from the original home-page tables via `tools/extract-classic-components.py`) |
| `data/libraries-ui.json` | UI component libraries across platforms |
| `data/libraries-deps.json` | Non-UI dependencies (networking, DI, persistence, testing, build tools…) |
| `data/equivalents.json` | Platform concepts and tooling equivalents |
| `quiz-data.json` | Quiz questions |

Library install lines intentionally omit versions (they go stale); check each library's page for the current release.
Mappings are best-effort, so confirm against the linked official docs before relying on them.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Blog authoring

Posts are Markdown in `blog/src/*.md`, compiled to static HTML by a zero-dependency Node script:

```bash
node tools/build-blog.mjs              # build blog/*.html and blog/posts.json
node tools/build-blog.mjs --check      # validate only
node --test tools/                     # converter/validator tests
SITE_URL=https://example.com node tools/build-blog.mjs   # also emits canonical URLs, rss.xml, sitemap.xml, robots.txt
```

Generated files are committed because hosting is static. See `blog/README.md` for the Markdown dialect.

## How you can help

- **Feedback:** [share your thoughts](https://forms.gle/qMAD5hX2VPjahmLAA)
- **Contribute:** [join the contributors list](https://forms.gle/wjcHvYAdYxPHodTN8)
