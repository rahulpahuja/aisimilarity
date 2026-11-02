# Blog

Posts are written in Markdown under `blog/src/` and compiled by a zero-dependency Node script into static HTML pages.
Hosting is static with no CI, so **the generated files are committed**: after editing a post, rebuild and commit both the
source and the generated output.

## Files

| Path | What it is |
| --- | --- |
| `blog/src/<slug>.md` | Source posts (edit these) |
| `blog/<slug>.html` | Generated post pages (do not edit by hand) |
| `blog/posts.json` | Generated index data, sorted by `order` (read by the blog index and the home page) |
| `blog/index.html`, `blog.css`, `blog.js` | Blog index (search, category/tag filters) and the post-page behaviour (syntax highlighting, copy buttons, table of contents) |
| `tools/build-blog.mjs` | The compiler (Node 20+, standard library only) |
| `tools/build-blog.test.mjs` | Tests: `node --test tools/` |

## Add a post

1. Create `blog/src/<slug>.md`. The filename (without `.md`) must equal the `slug` in the frontmatter.
2. Write the frontmatter and body (see below).
3. Run `node tools/build-blog.mjs`. If anything violates the dialect the build prints every problem as `file:line: error: message` and writes nothing.
4. Commit `blog/src/<slug>.md`, `blog/<slug>.html` and `blog/posts.json`.

## Frontmatter

All seven keys are required; unknown or duplicate keys fail the build.

```
---
title: "Human title, <= 70 chars"
slug: kebab-case-matching-filename
date: 2026-11-02
order: 7
category: "Jetpack Compose"
tags: [compose, state]
summary: "One or two sentences, <= 160 chars. Used as the meta description."
---
```

- `date` is `YYYY-MM-DD`. `order` is an unquoted integer; it controls list order, previous/next links and the featured (first) post.
- `tags` is an inline list on one line. Tags and the category become filter links (`blog/?tag=...`, `blog/?cat=...`).
- A title over 70 characters, a summary over 160 characters or a repeated `order` value produce warnings, not errors.
- `index` is a reserved slug.

## Markdown dialect

Allowed:

- `##` and `###` headings (ids are generated; `##` headings form the table of contents)
- paragraphs, `- ` bullet lists and `1. ` numbered lists (no nesting)
- fenced code blocks with a language: `kotlin`, `java`, `swift`, `xml`, `groovy`, `toml`, `bash`, `json`, `yaml`, `properties`, `text` (aliases: `kts`, `gradle`, `sh`, `shell`, `zsh`, `html`, `yml`, `txt`)
- inline `code`, `**bold**`, `*italic*`, `[text](url)` where the URL is `http(s)`, `mailto:` or relative
- `> ` blockquotes (no nesting)
- GFM pipe tables with a header separator row (`:--`, `:-:`, `--:` alignment; use `\|` for a literal pipe)
- `---` horizontal rule

Rejected (the build fails with `file:line`): raw HTML (including `List<String>` outside backticks), `# ` h1 and `####`+ headings,
images, footnotes, nested lists, code blocks inside list items, indented code, unclosed fences, fences without a known language,
`javascript:`/`data:` and other non-allowed link schemes, missing/unknown/duplicate frontmatter keys, a slug that differs from the
filename, and duplicate slugs. Everything is HTML-escaped.

The reading time shown on a post is words / 200 (code included), minimum 1 minute.

## Build

```
node tools/build-blog.mjs            # validate and write blog/<slug>.html + blog/posts.json
node tools/build-blog.mjs --check    # validate only, write nothing
node --test tools/                   # run the test suite
```

Options: `--src DIR` (default `blog/src`), `--out DIR` (default `blog`), `--root DIR` (where `sitemap.xml` and `robots.txt` go; default the repo root).
Output is deterministic (no build timestamps), so unchanged posts produce no diff. A generated page whose source post was removed is reported as a warning; delete it yourself.

### SITE_URL (canonical links, RSS, sitemap)

Without `SITE_URL` the pages contain no absolute URLs, so they work from any host or sub-path. Set `SITE_URL` to the public address to also emit
`rel=canonical`, `og:url` and JSON-LD `BlogPosting` in each post, plus `blog/rss.xml`, `/sitemap.xml` and `/robots.txt`:

```
SITE_URL=https://example.com node tools/build-blog.mjs
SITE_URL=https://example.com/aisimilarity node tools/build-blog.mjs   # hosted under a sub-path
```

The sitemap lists the home page, `components/`, `libraries/`, `equivalents/`, `blog/`, every post and `iqlist.html`. Use the real production
URL when you run it for a release; the generated files embed it.
