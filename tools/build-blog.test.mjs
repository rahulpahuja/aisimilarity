/* Tests for tools/build-blog.mjs and the highlighter in blog/blog.js.   Run: node --test tools/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  escapeHtml, safeUrl, renderInline, renderMarkdown, parseFrontmatter, validateFrontmatter,
  compilePosts, renderPostPage, renderRss, renderSitemap, renderRobots, normaliseSiteUrl,
  slugifyHeading, readingMinutes, relatedPosts, postsIndex, main
} from './build-blog.mjs';

const md = (src) => renderMarkdown(src, { file: 't.md', startLine: 1 });
const ok = (src) => { const r = md(src); assert.deepEqual(r.errors, [], JSON.stringify(r.errors)); return r.html; };
const errs = (src) => md(src).errors;

const FM = (over = {}) => {
  const base = {
    title: '"A title"', slug: 'my-post', date: '2026-11-02', order: '1', category: '"Jetpack Compose"',
    tags: '[compose, state]', summary: '"A summary."'
  };
  const m = { ...base, ...over };
  return '---\n' + Object.entries(m).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n';
};
const post = (over, body = 'Hello world.\n') => FM(over) + '\n' + body;

/* ---------------- escaping ---------------- */

test('escapeHtml escapes <, >, &, quotes', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});

test('text escapes <, >, & and quotes (no raw tag can come out)', () => {
  const html = ok('Use a < b && c > d, say "hi" & \'bye\'.');
  assert.equal(html, '<p>Use a &lt; b &amp;&amp; c &gt; d, say &quot;hi&quot; &amp; &#39;bye&#39;.</p>');
});

test('inline code escapes and does not interpret markdown', () => {
  assert.equal(ok('Call `List<String> & **x**` now'), '<p>Call <code>List&lt;String&gt; &amp; **x**</code> now</p>');
});

test('fenced code escapes <, >, &, quotes verbatim and keeps blank lines', () => {
  const html = ok('```xml\n<a href="x">&amp; \'y\'</a>\n\n<b/>\n```');
  assert.match(html, /<code class="language-xml">&lt;a href=&quot;x&quot;&gt;&amp;amp; &#39;y&#39;&lt;\/a&gt;\n\n&lt;b\/&gt;<\/code>/);
  assert.ok(!html.includes('<a href'));
});

test('markdown syntax inside fenced code is not interpreted', () => {
  const html = ok('```kotlin\n# not a heading\n- not a list\n**x** [a](javascript:alert(1))\n```');
  assert.ok(!html.includes('<h1') && !html.includes('<li') && !html.includes('<strong'));
  assert.match(html, /# not a heading/);
});

test('table cells and headings are escaped', () => {
  const html = ok('## A < B & "C"\n\n| H & 1 | H2 |\n|---|---|\n| `<x>` | a < b |');
  assert.match(html, /<h2 id="a-b-c">A &lt; B &amp; &quot;C&quot; /);
  assert.match(html, /<th scope="col">H &amp; 1<\/th>/);
  assert.match(html, /<td><code>&lt;x&gt;<\/code><\/td><td>a &lt; b<\/td>/);
});

/* ---------------- URLs ---------------- */

test('safeUrl allows http(s), mailto and relative; rejects the rest', () => {
  for (const u of ['https://a.dev/x?y=1#z', 'http://a.dev', 'mailto:a@b.dev', '../equivalents/', 'post.html#x', '#top', '?q=1', '/abs/path'])
    assert.equal(safeUrl(u), u, u);
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x',
    'vbscript:x', 'file:///etc/passwd', '//evil.example/x', 'https://', 'ftp://x', 'http://a b', 'https://x"onclick=1', ''])
    assert.equal(safeUrl(u), null, JSON.stringify(u));
});

test('javascript: link is rejected with the line number', () => {
  const r = md('ok line\n\nclick [here](javascript:alert(1)) now');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 3);
  assert.match(r.errors[0].message, /link URL not allowed/);
});

test('data: schemes are rejected; entity-obfuscated schemes stay inert', () => {
  assert.equal(errs('[x](data:text/html;base64,AAAA)').length, 1);
  // '&' is escaped in output, so the entity stays literal text in a relative URL and can never decode to a scheme
  assert.match(ok('[x](java&#115;cript:alert(1))'), /href="java&amp;#115;cript:alert\(1\)"/);
});

test('links: external gets rel+target, relative does not, quotes in href are escaped', () => {
  const html = ok('[a](https://x.dev/?a=1&b=2) and [b](../equivalents/)');
  assert.match(html, /<a href="https:\/\/x\.dev\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">a<\/a>/);
  assert.match(html, /<a href="\.\.\/equivalents\/">b<\/a>/);
});

test('link text is escaped and may contain code/emphasis', () => {
  const html = ok('[`a<b` *x* <3](https://x.dev)');
  assert.match(html, />`?<code>a&lt;b<\/code> <em>x<\/em> &lt;3<\/a>/);
});

test('headings never contain nested anchors from links', () => {
  const html = ok('## See [docs](https://x.dev)');
  assert.equal((html.match(/<a /g) || []).length, 1);
});

/* ---------------- reject rules ---------------- */

test('rejects raw HTML (tags, comments, closing tags) outside code', () => {
  for (const s of ['a <div>x</div>', 'x <!-- c --> y', '<script>alert(1)</script>', 'List<String> in prose', 'a <br/> b', '<https://x.dev>']) {
    const e = errs(s);
    assert.ok(e.length >= 1, s);
    assert.match(e[0].message, /raw HTML/, s);
  }
});

test('raw HTML inside code spans/fences is fine', () => {
  ok('`<div>` and\n\n```xml\n<div/>\n```');
});

test('rejects h1 and h4+ headings, with line numbers', () => {
  const e = errs('para\n\n# Title\n\n#### deep');
  assert.deepEqual(e.map((x) => x.line), [3, 5]);
  assert.match(e[0].message, /h1/);
  assert.match(e[1].message, /level 4/);
});

test('"#hashtag" without a space is plain text, not a heading', () => {
  assert.equal(ok('#hashtag here'), '<p>#hashtag here</p>');
});

test('rejects images and footnotes', () => {
  assert.match(errs('![alt](a.png)')[0].message, /images/);
  assert.match(errs('text[^1]\n\n[^1]: note')[0].message, /footnotes/);
});

test('rejects nested lists and list code blocks', () => {
  const e = errs('- a\n  - b\n- c');
  assert.equal(e.length, 1);
  assert.equal(e[0].line, 2);
  assert.match(e[0].message, /nested lists/);
  assert.match(errs('- a\n  ```kotlin\n  x\n  ```')[0].message, /inside list items/);
});

test('rejects indented code and unclosed fences', () => {
  assert.match(errs('para\n\n    indented()')[0].message, /indented/);
  const e = errs('x\n\n```kotlin\nval a = 1');
  assert.equal(e[0].line, 3);
  assert.match(e[0].message, /unclosed/);
});

test('code fence needs a known language', () => {
  assert.match(errs('```\nx\n```')[0].message, /needs a language/);
  assert.match(errs('```brainfuck\nx\n```')[0].message, /unsupported code language/);
  assert.match(errs('```kotlin title=x\nx\n```')[0].message, /info string/);
});

test('rejects nested blockquotes', () => {
  assert.match(errs('> a\n> > b')[0].message, /nested blockquotes/);
});

test('control characters are rejected in inline text', () => {
  assert.match(errs('a \u0000 b')[0].message, /control/);
});

/* ---------------- constructs ---------------- */

test('headings get unique ids, ## and ### only, reserved ids avoided', () => {
  const r = md('## Main\n\n## Setup\n\n## Setup\n\n### Sub `x_y`');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.headings.map((h) => h.id), ['main-2', 'setup', 'setup-2', 'sub-x-y']);
  assert.match(r.html, /<h2 id="setup">Setup <a class="heading-anchor" href="#setup"/);
  assert.equal(slugifyHeading('TL;DR'), 'tl-dr');
  assert.equal(slugifyHeading('???'), 'section');
});

test('paragraphs, bold, italic, underscores, escapes', () => {
  assert.equal(ok('a **b** *c* _d_ snake_case_name \\*lit\\*'), '<p>a <strong>b</strong> <em>c</em> <em>d</em> snake_case_name *lit*</p>');
  assert.equal(ok('line one\nline two'), '<p>line one\nline two</p>');
});

test('bullet and numbered lists, lazy continuation, start number', () => {
  assert.equal(ok('- a\n- **b**\n  more\n\n- c'), '<ul><li>a</li><li><strong>b</strong>\nmore</li><li>c</li></ul>');
  assert.equal(ok('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(ok('3. x\n4. y'), '<ol start="3"><li>x</li><li>y</li></ol>');
  assert.equal(ok('text:\n- a\n- b'), '<p>text:</p>\n<ul><li>a</li><li>b</li></ul>');
});

test('bold at line start is not a list', () => {
  assert.equal(ok('**Note** x'), '<p><strong>Note</strong> x</p>');
});

test('fenced code: language label, aliases, copy button, pre tabindex', () => {
  const html = ok('```kts\nval x = 1\n```\n\n```sh\nls\n```');
  assert.match(html, /data-lang="kotlin"><figcaption><span class="code-lang">Kotlin<\/span><button type="button" class="code-copy" hidden>Copy<\/button>/);
  assert.match(html, /<pre tabindex="0"><code class="language-kotlin">val x = 1<\/code>/);
  assert.match(html, /language-bash/);
  for (const l of ['kotlin', 'xml', 'groovy', 'toml', 'bash', 'swift', 'json', 'java']) ok('```' + l + '\nx\n```');
});

test('longer fence can contain a shorter one', () => {
  const html = ok('````kotlin\n```\ninner\n```\n````');
  assert.match(html, /```\ninner\n```/);
});

test('blockquote single and multi paragraph', () => {
  assert.equal(ok('> a **b**\n> c'), '<blockquote><p>a <strong>b</strong>\nc</p></blockquote>');
  assert.equal(ok('> a\n>\n> b'), '<blockquote><p>a</p><p>b</p></blockquote>');
});

test('horizontal rule', () => { assert.equal(ok('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>'); });

test('GFM table: header, alignment, inline content, escaped pipes, ragged rows', () => {
  const html = ok('| A | B | C |\n|:--|:-:|--:|\n| `x` | **y** | a \\| b |\n| only |');
  assert.match(html, /<div class="table-wrap"><table class="data">/);
  assert.match(html, /<th scope="col" class="align-center">B<\/th>/);
  assert.match(html, /<td class="align-right">a \| b<\/td>/);
  assert.match(html, /<td class="align-left">only<\/td><td class="align-center"><\/td><td class="align-right"><\/td>/);
  assert.match(html, /<td class="align-left"><code>x<\/code><\/td>/);
});

test('table without outer pipes, followed by paragraph', () => {
  const html = ok('A | B\n--|--\n1 | 2\n\nafter');
  assert.match(html, /<tr><td>1<\/td><td>2<\/td><\/tr>/);
  assert.match(html, /<p>after<\/p>$/);
});

test('table errors: header/separator mismatch and too many cells', () => {
  assert.match(errs('| A | B |\n|---|\n| 1 | 2 |')[0].message, /separator row has 1/);
  assert.match(errs('| A |\n|---|\n| 1 | 2 |')[0].message, /row has 2 cells/);
});

test('error line numbers honour startLine offset', () => {
  const r = renderMarkdown('ok\n\n# bad', { file: 'x.md', startLine: 10 });
  assert.equal(r.errors[0].line, 12);
  assert.equal(r.errors[0].file, 'x.md');
});

test('inline error line points inside multi-line paragraph', () => {
  const r = md('first\nsecond\nthird <b>x</b>');
  assert.equal(r.errors[0].line, 3);
});

test('renderInline throws BuildError with file and line', () => {
  assert.throws(() => renderInline('a <i>b</i>', { file: 'f.md', line: 7 }), (e) => e.name === 'BuildError' && e.line === 7 && e.file === 'f.md');
});

test('reading time: words/200, minimum 1', () => {
  assert.equal(readingMinutes(0), 1);
  assert.equal(readingMinutes(199), 1);
  assert.equal(readingMinutes(1000), 5);
  assert.equal(readingMinutes(1500), 8); // 7.5 rounds up
  const r = md(Array.from({ length: 450 }, (_, i) => 'w' + i).join(' '));
  assert.equal(r.words, 450);
});

/* ---------------- frontmatter ---------------- */

const validate = (text, file = 'my-post.md') => validateFrontmatter(parseFrontmatter(text, file), file);

test('valid frontmatter parses into typed fields', () => {
  const v = validate(post({ title: '"He said \\"hi\\": ok"', tags: '[compose, "state flow", \'x\']' }));
  assert.deepEqual(v.errors, []);
  assert.equal(v.fields.title, 'He said "hi": ok');
  assert.equal(v.fields.order, 1);
  assert.deepEqual(v.fields.tags, ['compose', 'state flow', 'x']);
});

test('frontmatter: missing block / unclosed block', () => {
  assert.match(validate('hello').errors[0].message, /missing frontmatter/);
  assert.match(validate('---\ntitle: "x"\n').errors[0].message, /not closed/);
});

test('frontmatter: missing required keys reported per key', () => {
  const v = validate(post({ summary: null, tags: null }));
  assert.deepEqual(v.errors.map((e) => e.message).sort(), ['missing required frontmatter key "summary"', 'missing required frontmatter key "tags"']);
});

test('frontmatter: unknown and duplicate keys fail with line numbers', () => {
  const t = '---\ntitle: "x"\nauthor: me\ntitle: "y"\n---\nbody';
  const e = validate(t).errors;
  assert.ok(e.some((x) => x.line === 3 && /unknown frontmatter key "author"/.test(x.message)));
  assert.ok(e.some((x) => x.line === 4 && /duplicate frontmatter key/.test(x.message)));
});

test('frontmatter: slug rules', () => {
  assert.match(validate(post({ slug: 'Bad_Slug' })).errors[0].message, /kebab-case/);
  assert.match(validate(post({ slug: 'other-name' })).errors[0].message, /does not match the filename "my-post.md"/);
  assert.match(validate(post({ slug: 'index' }), 'index.md').errors[0].message, /reserved/);
});

test('frontmatter: date, order, tags, empty values', () => {
  assert.match(validate(post({ date: '2026-02-30' })).errors[0].message, /date/);
  assert.match(validate(post({ date: '11/02/2026' })).errors[0].message, /date/);
  assert.match(validate(post({ order: '"3"' })).errors[0].message, /order/);
  assert.match(validate(post({ order: '3.5' })).errors[0].message, /order/);
  assert.match(validate(post({ tags: 'compose' })).errors[0].message, /inline list/);
  assert.match(validate(post({ tags: '[]' })).errors[0].message, /at least one/);
  assert.match(validate(post({ tags: '[a, a]' })).errors[0].message, /duplicate tags/);
  assert.match(validate(post({ title: '""' })).errors[0].message, /must not be empty/);
  assert.match(validate(post({ title: '"unterminated' })).errors[0].message, /unterminated/);
});

test('frontmatter: over-long title/summary are warnings, not errors', () => {
  const v = validate(post({ title: '"' + 'x'.repeat(80) + '"' }));
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings.length, 1);
});

/* ---------------- compile / pages ---------------- */

const src = (name, text) => ({ file: name, text });
const two = () => compilePosts([
  src('a-post.md', post({ slug: 'a-post', order: '2', tags: '[compose, state]' }, '## One\n\nText `x`.\n\n## Two\n\nMore.\n')),
  src('b-post.md', post({ slug: 'b-post', order: '1', tags: '[state, room]', title: '"B <title> & more"' }, '## Only\n\nText.\n'))
]);

test('compilePosts sorts by order and reports duplicate slugs', () => {
  const r = two();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.posts.map((p) => p.slug), ['b-post', 'a-post']);
  const d = compilePosts([src('a-post.md', post({ slug: 'a-post' })), src('b-post.md', post({ slug: 'a-post' }))]);
  assert.ok(d.errors.some((e) => /duplicate slug "a-post"/.test(e.message) && e.file === 'b-post.md'));
});

test('compilePosts propagates body errors with real file lines', () => {
  const text = post({ slug: 'a-post' }, 'ok\n\n# h1\n');
  const lineOfH1 = text.split('\n').findIndex((l) => l === '# h1') + 1;
  const r = compilePosts([src('a-post.md', text)]);
  assert.equal(r.errors[0].line, lineOfH1);
  assert.equal(r.posts.length, 0);
});

test('posts.json shape', () => {
  const idx = postsIndex(two().posts);
  assert.deepEqual(Object.keys(idx[0]), ['slug', 'title', 'date', 'order', 'category', 'tags', 'summary', 'readingMinutes']);
  assert.equal(idx[0].slug, 'b-post');
  assert.equal(idx[0].readingMinutes, 1);
});

test('post page: skeleton, escaping, TOC, chips, prev/next, CTA, no absolute URLs without SITE_URL', () => {
  const { posts } = two();
  const html = renderPostPage(posts[1], posts);   // a-post (order 2)
  assert.match(html, /<html lang="en" data-root="\.\.\/" data-page="blog">/);
  assert.match(html, /<script src="\.\.\/assets\/js\/theme\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="blog\.css">/);
  assert.match(html, /G-92KXYXDDWD/);
  assert.match(html, /<nav class="toc" id="toc"/);
  assert.match(html, /href="#one"/);
  assert.match(html, /href="\.\/\?cat=Jetpack%20Compose"/);
  assert.match(html, /href="\.\/\?tag=state"/);
  assert.match(html, /rel="prev" href="b-post\.html"/);
  assert.match(html, /href="\.\.\/equivalents\/">Open the Equivalents page/);
  assert.match(html, /Related posts/);
  assert.ok(!/canonical|og:url|ld\+json|rss\.xml/.test(html));
  assert.ok(!/https?:\/\/(?!fonts\.googleapis|www\.googletagmanager)/.test(html.replace(/<\/?[^>]*schema[^>]*>/g, '')));
  const b = renderPostPage(posts[0], posts);
  assert.ok(b.includes('<title>B &lt;title&gt; &amp; more | AI Similarity</title>'));
  assert.ok(!b.includes('B <title>'));
  assert.ok(!/class="toc"/.test(b), 'single-heading posts get no TOC');
});

test('post page with SITE_URL adds canonical, og:url, JSON-LD (script-safe), rss link', () => {
  const { posts } = two();
  posts[0].title = 'T </script><script>alert(1)</script>';
  const html = renderPostPage(posts[0], posts, { siteUrl: 'https://example.dev/base' });
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.dev\/base\/blog\/b-post\.html">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/example\.dev\/base\/blog\/b-post\.html">/);
  const ld = /<script type="application\/ld\+json">\n([\s\S]*?)\n\s*<\/script>/.exec(html);
  assert.ok(ld, 'json-ld present');
  assert.ok(!ld[1].includes('</script'));
  const obj = JSON.parse(ld[1]);
  assert.equal(obj['@type'], 'BlogPosting');
  assert.equal(obj.headline, posts[0].title);
  assert.equal((html.match(/<script>alert/g) || []).length, 0);
});

test('related posts are by shared tags only, best first, never self', () => {
  const mk = (slug, order, tags, category = 'C') => ({ slug, order, tags, category });
  const all = [mk('a', 1, ['x', 'y']), mk('b', 2, ['y']), mk('c', 3, ['x', 'y'], 'D'), mk('d', 4, ['z'])];
  assert.deepEqual(relatedPosts(all[0], all).map((p) => p.slug), ['b', 'c'].sort((p, q) => (p === 'c' ? -1 : 1)));
  assert.deepEqual(relatedPosts(all[3], all), []);
});

test('rss, sitemap, robots', () => {
  const { posts } = two();
  const rss = renderRss(posts, 'https://e.dev');
  assert.match(rss, /<title>B &lt;title&gt; &amp; more<\/title>/);
  assert.match(rss, /<link>https:\/\/e\.dev\/blog\/a-post\.html<\/link>/);
  assert.match(rss, /<pubDate>Mon, 02 Nov 2026 00:00:00 GMT<\/pubDate>/);
  const sm = renderSitemap(posts, 'https://e.dev');
  for (const p of ['/', '/components/', '/libraries/', '/equivalents/', '/blog/', '/blog/a-post.html', '/blog/b-post.html', '/iqlist.html'])
    assert.ok(sm.includes(`<loc>https://e.dev${p}</loc>`), p);
  assert.equal(renderRobots('https://e.dev'), 'User-agent: *\nAllow: /\n\nSitemap: https://e.dev/sitemap.xml\n');
});

test('normaliseSiteUrl', () => {
  assert.equal(normaliseSiteUrl(''), '');
  assert.equal(normaliseSiteUrl('https://e.dev/'), 'https://e.dev');
  assert.equal(normaliseSiteUrl('https://e.dev/sub//'), 'https://e.dev/sub');
  assert.throws(() => normaliseSiteUrl('javascript:alert(1)'));
  assert.throws(() => normaliseSiteUrl('nonsense'));
  assert.throws(() => normaliseSiteUrl('https://e.dev/?x=1'));
});

/* ---------------- CLI end-to-end (fixture dirs in os.tmpdir) ---------------- */

function withFixture(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'blog', 'src'), { recursive: true });
    for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'blog', 'src', n), t);
    return fn(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const quiet = (fn) => {
  const log = console.log, warn = console.warn, error = console.error;
  const buf = [];
  console.log = console.warn = console.error = (...a) => buf.push(a.join(' '));
  try { return { code: fn(), out: buf.join('\n') }; } finally { console.log = log; console.warn = warn; console.error = error; }
};

test('CLI: builds pages + posts.json; SITE_URL adds rss/sitemap/robots; output is deterministic', () => {
  withFixture({ 'a-post.md': post({ slug: 'a-post' }, '## A\n\nx\n\n## B\n\ny\n') }, (dir) => {
    let r = quiet(() => main(['--root', dir], {}));
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(path.join(dir, 'blog', 'a-post.html')));
    assert.ok(!fs.existsSync(path.join(dir, 'blog', 'rss.xml')));
    assert.ok(!fs.existsSync(path.join(dir, 'sitemap.xml')));
    const first = fs.readFileSync(path.join(dir, 'blog', 'a-post.html'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'blog', 'posts.json'), 'utf8'));
    assert.equal(json[0].slug, 'a-post');
    r = quiet(() => main(['--root', dir], {}));
    assert.equal(fs.readFileSync(path.join(dir, 'blog', 'a-post.html'), 'utf8'), first);
    r = quiet(() => main(['--root', dir], { SITE_URL: 'https://e.dev' }));
    assert.equal(r.code, 0, r.out);
    for (const f of ['blog/rss.xml', 'sitemap.xml', 'robots.txt']) assert.ok(fs.existsSync(path.join(dir, f)), f);
    assert.match(fs.readFileSync(path.join(dir, 'blog', 'a-post.html'), 'utf8'), /rel="canonical"/);
  });
});

test('CLI: any error fails with file:line and writes nothing', () => {
  withFixture({
    'good.md': post({ slug: 'good' }),
    'bad.md': post({ slug: 'bad' }, 'fine\n\n# H1\n'),
    'wrong.md': post({ slug: 'mismatch' })
  }, (dir) => {
    const r = quiet(() => main(['--root', dir], {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /bad\.md:\d+: error: h1/);
    assert.match(r.out, /wrong\.md:\d+: error: slug "mismatch" does not match/);
    assert.ok(!fs.existsSync(path.join(dir, 'blog', 'good.html')));
    assert.ok(!fs.existsSync(path.join(dir, 'blog', 'posts.json')));
  });
});

test('CLI: --src/--out override and --check writes nothing', () => {
  withFixture({ 'a-post.md': post({ slug: 'a-post' }) }, (dir) => {
    const out = path.join(dir, 'elsewhere');
    let r = quiet(() => main(['--root', dir, '--src', path.join(dir, 'blog', 'src'), '--out', out, '--check'], {}));
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(out));
    r = quiet(() => main(['--root', dir, '--out', out], {}));
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(path.join(out, 'a-post.html')));
  });
  assert.equal(quiet(() => main(['--bogus'], {})).code, 2);
  assert.equal(quiet(() => main(['--src', '/definitely/not/here'], {})).code, 2);
  assert.equal(quiet(() => main([], { SITE_URL: 'ftp://x' })).code, 2);
});

/* ---------------- highlighter (blog/blog.js) ---------------- */

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { highlight } = require(path.join(here, '..', 'blog', 'blog.js'));
const unhtml = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const SAMPLES = {
  kotlin: 'package a\n// c <b>\n@Composable fun A<T>(x: List<String> = emptyList(), s: String = "a\\"<b>$x") { val n = 0x1F + 1_000L /* "q" */ ; val r = """raw "<>" """ }',
  java: 'public class A<T> { @Override public String f() { return "x<y" + \'c\' + 1.5f; } /* a & b */ }',
  swift: '@MainActor struct V: View { var body: some View { Text("a<b \\(x)") } } // done\nlet s = """\n"q" <\n"""',
  xml: '<?xml version="1.0"?>\n<!-- c <x> -->\n<manifest xmlns:android="http://x" a="1 &amp; <2>">\n  <uses-permission android:name="a.b"/>\n</manifest>',
  groovy: "plugins { id 'com.android.application' }\n// c\ndependencies { implementation \"a:b:$v\" }\ndef x = '''multi\n<line>'''",
  toml: '# c <x>\n[versions]\nagp = "9.0.0"\nflag = true\n[libraries]\nx = { module = "a:b", version.ref = "agp" }\nn = 12',
  bash: '# comment <\nif [ "$A" = "x" ]; then echo \'a<b\' && ./gradlew assembleRelease --info; fi\nexport P=${HOME}/x > out.txt',
  json: '{"a": [1, 2.5e3, true, null], "b<": {"c": "x\\"y"}}'
};

test('highlighter: output text equals input for every language (nothing lost, nothing double-escaped)', () => {
  for (const [lang, code] of Object.entries(SAMPLES)) assert.equal(unhtml(highlight(code, lang)), code, lang);
});

test('highlighter: no raw < or > leaks from code; only our span tags exist', () => {
  for (const [lang, code] of Object.entries(SAMPLES)) {
    const h = highlight(code, lang);
    const stripped = h.replace(/<span class="t-[a-z]+">|<\/span>/g, '');
    assert.ok(!/[<>]/.test(stripped), `${lang}: ${stripped}`);
  }
  const evil = highlight('"</code><img src=x onerror=alert(1)>"', 'kotlin');
  assert.ok(!evil.includes('<img'));
  assert.ok(evil.includes('&lt;img'));
});

test('highlighter: tokens classified', () => {
  const k = highlight('val x = 42 // hi\n"s"', 'kotlin');
  assert.match(k, /<span class="t-k">val<\/span>/);
  assert.match(k, /<span class="t-n">42<\/span>/);
  assert.match(k, /<span class="t-c">\/\/ hi<\/span>/);
  assert.match(k, /<span class="t-s">&quot;s&quot;<\/span>/);
  assert.match(highlight('{"k": 1}', 'json'), /<span class="t-a">&quot;k&quot;<\/span>/);
  assert.equal(highlight('a < b', 'text'), 'a &lt; b');
  assert.equal(highlight('a < b', 'unknown-lang'), 'a &lt; b');
});
