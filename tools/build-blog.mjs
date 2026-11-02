#!/usr/bin/env node
/* build-blog.mjs — zero-dependency static blog compiler.
 *
 *   node tools/build-blog.mjs [--src DIR] [--out DIR] [--root DIR] [--check]
 *
 * Reads Markdown posts (restricted dialect, see blog/README.md) from blog/src/*.md and writes
 *   blog/<slug>.html   one static page per post
 *   blog/posts.json    index data (sorted by `order`)
 * and, only when the SITE_URL env var is set (absolute URLs are required for these):
 *   blog/rss.xml, <root>/sitemap.xml, <root>/robots.txt, plus rel=canonical / og:url / JSON-LD in each post.
 *
 * Output is deterministic (no build timestamps) so committed files only change when content does.
 * Validation runs over ALL posts first; if anything is wrong, every problem is printed as
 * `file:line: message` and NOTHING is written.
 *
 * Node 20+, stdlib only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

export const REQUIRED_KEYS = ['title', 'slug', 'date', 'order', 'category', 'tags', 'summary'];
export const SITE_NAME = 'AI Similarity';
const RESERVED_SLUGS = new Set(['index']); // would overwrite blog/index.html
const RESERVED_IDS = ['main', 'toc', 'site-header', 'site-footer', 'related', 'post-nav', 'post-content'];

/* canonical language -> label. Aliases are normalised to a canonical language. */
export const LANG_LABELS = {
  kotlin: 'Kotlin', java: 'Java', swift: 'Swift', xml: 'XML', groovy: 'Groovy', toml: 'TOML',
  bash: 'Bash', json: 'JSON', yaml: 'YAML', properties: 'Properties', text: 'Text'
};
export const LANG_ALIASES = {
  sh: 'bash', shell: 'bash', zsh: 'bash', kts: 'kotlin', gradle: 'groovy', html: 'xml',
  yml: 'yaml', txt: 'text', plaintext: 'text'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export class BuildError extends Error {
  constructor(message, line, file) {
    super(message);
    this.name = 'BuildError';
    this.line = line;
    this.file = file;
  }
}

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

function xmlEscape(s) { return escapeHtml(s); }

/* Safe to embed inside <script type="application/ld+json">. */
function jsonForScript(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function slugifyHeading(text) {
  const s = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'section';
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function htmlToText(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
}

function countWords(text) {
  return (String(text).match(/[^\s]+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function readingMinutes(words) { return Math.max(1, Math.round(words / 200)); }

/* ------------------------------------------------------------------ */
/* URL policy                                                          */
/* ------------------------------------------------------------------ */

/* Returns the cleaned URL string if it is http(s), mailto:, or a relative reference; otherwise null. */
export function safeUrl(raw) {
  const url = String(raw).trim();
  if (!url) return null;
  if (/[\u0000-\u0020\u007f-\u009f<>"`\\]/.test(url)) return null;   // whitespace/control/quote chars
  if (/^\/\//.test(url)) return null;                                 // protocol-relative
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http' || s === 'https') return /^https?:\/\/[^/?#]+/i.test(url) ? url : null;
    if (s === 'mailto') return /^mailto:[^\s]+$/i.test(url) ? url : null;
    return null;
  }
  return url; // relative (path, ?query, #fragment)
}

/* ------------------------------------------------------------------ */
/* inline Markdown                                                     */
/* ------------------------------------------------------------------ */

/* Mask code spans and backslash escapes with same-length filler so regex checks keep source offsets. */
function maskInline(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1])) { out += 'xx'; i += 2; continue; }
    if (c === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const close = findBacktickClose(text, i + n, n);
      if (close !== -1) {
        out += 'x'.repeat(close + n - i).replace(/x/g, (_, k) => (text[i + k] === '\n' ? '\n' : 'x'));
        i = close + n;
        continue;
      }
      out += '`'.repeat(n);
      i += n;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function findBacktickClose(text, from, n) {
  let i = from;
  while (i < text.length) {
    if (text[i] === '`') {
      let k = 0;
      while (text[i + k] === '`') k++;
      if (k === n) return i;
      i += k;
    } else i++;
  }
  return -1;
}

function lineOffsetAt(text, index) {
  let n = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

const SENT_OPEN = '\u0000';
const SENT_CLOSE = '\u0001';

/* Render one inline run (paragraph/heading/cell text) to safe HTML. Throws BuildError on forbidden syntax.
 * ctx: { file, line, noLinks }  — `line` is the 1-based source line where `text` starts. */
export function renderInline(text, ctx = {}) {
  const file = ctx.file;
  const baseLine = ctx.line || 1;
  const fail = (msg, offset) => { throw new BuildError(msg, baseLine + lineOffsetAt(text, offset || 0), file); };

  if (/[\u0000\u0001]/.test(text)) fail('control characters are not allowed', text.search(/[\u0000\u0001]/));

  const masked = maskInline(text);
  let m;
  if ((m = /<[A-Za-z/!?]/.exec(masked))) {
    fail('raw HTML is not allowed (put code such as List<String> in backticks)', m.index);
  }
  if ((m = /!\[/.exec(masked))) fail('images are not allowed', m.index);
  if ((m = /\[\^/.exec(masked))) fail('footnotes are not allowed', m.index);

  const stash = [];
  const put = (html) => { stash.push(html); return SENT_OPEN + (stash.length - 1) + SENT_CLOSE; };

  let s = text;

  // 1. code spans (content verbatim, escaped)
  {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) {
        out += put(escapeHtml(s[i + 1]));
        i += 2;
        continue;
      }
      if (c === '`') {
        let n = 0;
        while (s[i + n] === '`') n++;
        const close = findBacktickClose(s, i + n, n);
        if (close !== -1) {
          let code = s.slice(i + n, close).replace(/\n/g, ' ');
          if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
          out += put('<code>' + escapeHtml(code) + '</code>');
          i = close + n;
          continue;
        }
        out += '`'.repeat(n);
        i += n;
        continue;
      }
      out += c;
      i++;
    }
    s = out;
  }

  // 2. links  [text](url "title")
  {
    const linkRe = /\[((?:[^\[\]\\\n]|\\.|\n)*?)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"([^"]*)")?\)/g;
    s = s.replace(linkRe, (whole, label, rawUrl) => {
      if (rawUrl.includes(SENT_OPEN)) fail('invalid link URL: ' + restore(rawUrl), text.indexOf('](') );
      const url = safeUrl(rawUrl);
      if (url === null) {
        const at = text.indexOf(rawUrl);
        fail(`link URL not allowed: "${rawUrl}" (only http(s), mailto: and relative links)`, at === -1 ? 0 : at);
      }
      const inner = formatText(label);
      if (ctx.noLinks) return inner;
      const external = /^https?:/i.test(url);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return put('<a href="' + escapeHtml(url) + '"' + attrs + '>' + inner + '</a>');
    });
  }

  function restore(str) {
    let prev;
    let out = str;
    let guard = 0;
    do {
      prev = out;
      out = out.replace(/\u0000(\d+)\u0001/g, (_, n) => stash[Number(n)]);
    } while (out !== prev && ++guard < 8);
    return out;
  }

  // escape + emphasis on text that still contains sentinels only for stashed (already safe) html
  function formatText(str) {
    let t = escapeHtml(str);
    t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>');
    t = t.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    t = t.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    return t;
  }

  return restore(formatText(s));
}

/* ------------------------------------------------------------------ */
/* block Markdown                                                      */
/* ------------------------------------------------------------------ */

const RE_FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;
const RE_FENCE_CLOSE = /^ {0,3}(`{3,})\s*$/;
const RE_HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;
const RE_HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_LIST = /^( *)([-*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isBlockStart(lines, i) {
  const l = lines[i];
  if (RE_FENCE_OPEN.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l)) return true;
  const lm = RE_LIST.exec(l);
  if (lm && lm[1].length <= 1 && (lm[3] !== undefined) && (/^[-*]$/.test(lm[2]) || /^1[.)]$/.test(lm[2]))) return true;
  if (l.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && RE_TABLE_SEP.test(lines[i + 1])
    && lines[i + 1].includes('|')) return true;
  return false;
}

/* Convert the body of a post. Never throws for content problems: they are returned in `errors`
 * as {file, line, message}. */
export function renderMarkdown(src, { file = 'input.md', startLine = 1 } = {}) {
  const lines = String(src).replace(/^\uFEFF/, '').split(/\r?\n/);
  const n = lines.length;
  const errors = [];
  const headings = [];
  const out = [];
  const usedIds = new Set(RESERVED_IDS);
  let words = 0;

  const L = (i) => startLine + i;
  const err = (line, message) => errors.push({ file, line, message });

  const inline = (text, line, extra = {}) => {
    try {
      return renderInline(text, { file, line, ...extra });
    } catch (e) {
      if (e instanceof BuildError) { err(e.line, e.message); return escapeHtml(text); }
      throw e;
    }
  };

  const uniqueId = (text) => {
    const base = slugifyHeading(text);
    let id = base;
    for (let k = 2; usedIds.has(id); k++) id = base + '-' + k;
    usedIds.add(id);
    return id;
  };

  const plain = (md) => md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`+/g, '').replace(/\\(.)/g, '$1').replace(/[*_]{1,2}/g, '');

  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    /* fenced code */
    let m = RE_FENCE_OPEN.exec(line);
    if (m) {
      const fence = m[1];
      const info = m[2].trim();
      const open = i;
      i++;
      const code = [];
      let closed = false;
      while (i < n) {
        const c = RE_FENCE_CLOSE.exec(lines[i]);
        if (c && c[1].length >= fence.length) { closed = true; i++; break; }
        code.push(lines[i]);
        i++;
      }
      if (!closed) err(L(open), 'unclosed code fence');
      let lang = info.toLowerCase();
      if (!info) err(L(open), 'code fence needs a language tag (e.g. ```kotlin)');
      else if (/\s/.test(info)) err(L(open), `unsupported code fence info string "${info}" (language only)`);
      else {
        lang = LANG_ALIASES[lang] || lang;
        if (!LANG_LABELS[lang]) {
          err(L(open), `unsupported code language "${info}" (allowed: ${Object.keys(LANG_LABELS).join(', ')})`);
        }
      }
      const canon = LANG_LABELS[lang] ? lang : 'text';
      const body = code.join('\n');
      words += countWords(body);
      out.push(
        `<figure class="code-block" data-lang="${canon}"><figcaption><span class="code-lang">${LANG_LABELS[canon]}</span>` +
        '<button type="button" class="code-copy" hidden>Copy</button></figcaption>' +
        `<pre tabindex="0"><code class="language-${canon}">${escapeHtml(body)}</code></pre></figure>`
      );
      continue;
    }

    /* indented code is not part of the dialect */
    if (/^( {4,}|\t)\S/.test(line)) {
      err(L(i), 'indented code/blocks are not supported (use a fenced code block; nested lists are not allowed)');
      i++;
      while (i < n && !/^\s*$/.test(lines[i])) i++;
      continue;
    }

    /* heading */
    m = RE_HEADING.exec(line);
    if (m) {
      const level = m[1].length;
      if (level === 1) err(L(i), 'h1 ("# ") is not allowed: the title comes from the frontmatter; start at "##"');
      else if (level > 3) err(L(i), `heading level ${level} is not allowed (use ## or ###)`);
      else {
        const html = inline(m[2], L(i), { noLinks: true });
        const text = htmlToText(html);
        const id = uniqueId(text);
        headings.push({ level, id, text, html });
        words += countWords(text);
        out.push(`<h${level} id="${id}">${html} <a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`);
      }
      i++;
      continue;
    }

    /* horizontal rule */
    if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

    /* blockquote */
    if (RE_QUOTE.test(line)) {
      const start = i;
      const paras = [[]];
      while (i < n && RE_QUOTE.test(lines[i])) {
        const inner = lines[i].replace(/^ {0,3}>[ \t]?/, '');
        if (RE_QUOTE.test(inner)) err(L(i), 'nested blockquotes are not supported');
        if (/^\s*$/.test(inner)) { if (paras[paras.length - 1].length) paras.push([]); }
        else paras[paras.length - 1].push({ text: inner.trim(), line: L(i) });
        i++;
      }
      const html = paras.filter((p) => p.length).map((p) => {
        const t = p.map((x) => x.text).join('\n');
        words += countWords(plain(t));
        return '<p>' + inline(t, p[0].line) + '</p>';
      }).join('');
      if (!html) err(L(start), 'empty blockquote');
      out.push('<blockquote>' + html + '</blockquote>');
      continue;
    }

    /* table */
    if (line.includes('|') && i + 1 < n && lines[i + 1].includes('|') && RE_TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      const startLn = L(i);
      const align = sep.map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : ''));
      let ok = true;
      if (head.length !== sep.length) { err(startLn, `table header has ${head.length} cells but the separator row has ${sep.length}`); ok = false; }
      i += 2;
      const rows = [];
      while (i < n && !/^\s*$/.test(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        if (cells.length > head.length) { err(L(i), `table row has ${cells.length} cells but the header has ${head.length}`); ok = false; }
        rows.push({ cells, line: L(i) });
        i++;
      }
      if (!ok) continue;
      const cls = (k) => (align[k] ? ` class="align-${align[k]}"` : '');
      const th = head.map((c, k) => { words += countWords(plain(c)); return `<th scope="col"${cls(k)}>${inline(c, startLn)}</th>`; }).join('');
      const body = rows.map((r) => '<tr>' + head.map((_, k) => {
        const c = r.cells[k] || '';
        words += countWords(plain(c));
        return `<td${cls(k)}>${inline(c, r.line)}</td>`;
      }).join('') + '</tr>').join('');
      out.push(`<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    /* list */
    m = RE_LIST.exec(line);
    if (m && m[1].length <= 1) {
      const ordered = /\d/.test(m[2]);
      const startNum = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      let cur = null;
      const newItem = (mm, at) => { cur = { parts: [], line: L(at) }; items.push(cur); if (mm[3] && mm[3].trim()) cur.parts.push(mm[3].trim()); };
      newItem(m, i);
      i++;
      while (i < n) {
        const l = lines[i];
        if (/^\s*$/.test(l)) {
          let k = i + 1;
          while (k < n && /^\s*$/.test(lines[k])) k++;
          const nm = k < n ? RE_LIST.exec(lines[k]) : null;
          if (nm && nm[1].length <= 1 && /\d/.test(nm[2]) === ordered) { i = k; continue; }
          break;
        }
        const lm = RE_LIST.exec(l);
        if (lm) {
          if (lm[1].length >= 2) { err(L(i), 'nested lists are not supported'); i++; continue; }
          if (/\d/.test(lm[2]) !== ordered) break;
          newItem(lm, i);
          i++;
          continue;
        }
        if (/^\s+(`{3,}|~{3,})/.test(l)) { err(L(i), 'code blocks inside list items are not supported'); i++; continue; }
        if (RE_FENCE_OPEN.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l)) break;
        cur.parts.push(l.trim()); // continuation (indented or lazy)
        i++;
      }
      const lis = items.map((it) => {
        const t = it.parts.join('\n');
        words += countWords(plain(t));
        if (!t) { err(it.line, 'empty list item'); return '<li></li>'; }
        return '<li>' + inline(t, it.line) + '</li>';
      }).join('');
      out.push(ordered
        ? `<ol${startNum !== 1 ? ` start="${startNum}"` : ''}>${lis}</ol>`
        : `<ul>${lis}</ul>`);
      continue;
    }

    /* paragraph */
    {
      const start = i;
      const buf = [line.trim()];
      i++;
      while (i < n && !/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) { buf.push(lines[i].trim()); i++; }
      const t = buf.join('\n');
      words += countWords(plain(t));
      out.push('<p>' + inline(t, L(start)) + '</p>');
    }
  }

  return { html: out.join('\n'), headings, words, errors };
}

/* ------------------------------------------------------------------ */
/* frontmatter                                                         */
/* ------------------------------------------------------------------ */

function parseScalar(raw, line, file, errors) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    let j = 1;
    while (j < v.length && !(v[j] === '"' && v[j - 1] !== '\\')) j++;
    if (j >= v.length) { errors.push({ file, line, message: 'unterminated double-quoted string' }); return { quoted: true, value: '' }; }
    const rest = v.slice(j + 1).trim();
    if (rest && !rest.startsWith('#')) errors.push({ file, line, message: 'unexpected text after quoted string' });
    try { return { quoted: true, value: JSON.parse(v.slice(0, j + 1)) }; } catch {
      errors.push({ file, line, message: 'invalid escape in double-quoted string' });
      return { quoted: true, value: v.slice(1, j) };
    }
  }
  if (v.startsWith("'")) {
    let out = '';
    let j = 1;
    for (; j < v.length; j++) {
      if (v[j] === "'") { if (v[j + 1] === "'") { out += "'"; j++; continue; } break; }
      out += v[j];
    }
    if (j >= v.length) errors.push({ file, line, message: 'unterminated single-quoted string' });
    return { quoted: true, value: out };
  }
  return { quoted: false, value: v };
}

function parseList(raw, line, file, errors) {
  const v = raw.trim();
  if (!v.endsWith(']')) { errors.push({ file, line, message: 'tags must be an inline list like [a, b] on one line' }); return []; }
  const inner = v.slice(1, -1);
  const items = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === q && inner[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q) errors.push({ file, line, message: 'unterminated quote in list' });
  items.push(cur);
  return items.map((x) => x.trim()).filter((x) => x.length).map((x) => parseScalar(x, line, file, errors).value);
}

/* Returns { data, lines: {key: lineNo}, bodyStart (1-based line of first body line), errors } */
export function parseFrontmatter(src, file = 'input.md') {
  const errors = [];
  const lines = String(src).replace(/^\uFEFF/, '').split(/\r?\n/);
  const data = {};
  const lineOf = {};
  if (lines[0] === undefined || lines[0].trim() !== '---') {
    errors.push({ file, line: 1, message: 'missing frontmatter: the file must start with a "---" line' });
    return { data, lines: lineOf, body: lines.join('\n'), bodyStart: 1, errors };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end === -1) {
    errors.push({ file, line: 1, message: 'frontmatter is not closed with a second "---" line' });
    return { data, lines: lineOf, body: '', bodyStart: lines.length + 1, errors };
  }
  for (let i = 1; i < end; i++) {
    const ln = i + 1;
    const l = lines[i];
    if (/^\s*(#.*)?$/.test(l)) continue;
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*)|[ \t]*)$/.exec(l);
    if (!m) { errors.push({ file, line: ln, message: `invalid frontmatter line: "${l.trim()}" (expected key: value)` }); continue; }
    const key = m[1];
    if (!REQUIRED_KEYS.includes(key)) { errors.push({ file, line: ln, message: `unknown frontmatter key "${key}" (allowed: ${REQUIRED_KEYS.join(', ')})` }); continue; }
    if (key in data) { errors.push({ file, line: ln, message: `duplicate frontmatter key "${key}"` }); continue; }
    const raw = m[2] === undefined ? '' : m[2];
    lineOf[key] = ln;
    if (raw.trim().startsWith('[')) data[key] = { list: parseList(raw, ln, file, errors) };
    else data[key] = parseScalar(raw, ln, file, errors);
  }
  return { data, lines: lineOf, body: lines.slice(end + 1).join('\n'), bodyStart: end + 2, errors };
}

/* Validate raw frontmatter values and convert to typed fields. */
export function validateFrontmatter(fm, file) {
  const errors = [...fm.errors];
  const err = (line, message) => errors.push({ file, line, message });
  const d = fm.data;
  const out = {};

  for (const k of REQUIRED_KEYS) if (!(k in d)) err(1, `missing required frontmatter key "${k}"`);

  const str = (k, { max } = {}) => {
    if (!(k in d)) return;
    const v = d[k];
    if (v.list) { err(fm.lines[k], `"${k}" must be a string, not a list`); return; }
    if (!v.value) { err(fm.lines[k], `"${k}" must not be empty`); return; }
    if (max && v.value.length > max) warn(fm.lines[k], `"${k}" is ${v.value.length} characters (recommended <= ${max})`);
    out[k] = v.value;
  };
  const warnings = [];
  const warn = (line, message) => warnings.push({ file, line, message });

  str('title', { max: 70 });
  str('summary', { max: 160 });
  str('category');

  if ('slug' in d) {
    const v = d.slug;
    if (v.list || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.value)) err(fm.lines.slug, 'slug must be kebab-case (lowercase letters, digits, single hyphens)');
    else if (RESERVED_SLUGS.has(v.value)) err(fm.lines.slug, `slug "${v.value}" is reserved`);
    else if (file) {
      const base = path.basename(file, '.md');
      if (base !== v.value) err(fm.lines.slug, `slug "${v.value}" does not match the filename "${base}.md"`);
      out.slug = v.value;
    } else out.slug = v.value;
  }
  if ('date' in d) {
    const v = d.date;
    if (v.list || !isRealDate(v.value)) err(fm.lines.date, 'date must be a real calendar date formatted YYYY-MM-DD');
    else out.date = v.value;
  }
  if ('order' in d) {
    const v = d.order;
    if (v.list || v.quoted || !/^-?\d+$/.test(v.value)) err(fm.lines.order, 'order must be an unquoted integer');
    else out.order = parseInt(v.value, 10);
  }
  if ('tags' in d) {
    const v = d.tags;
    if (!v.list) err(fm.lines.tags, 'tags must be an inline list like [compose, state]');
    else if (!v.list.length) err(fm.lines.tags, 'tags must contain at least one tag');
    else {
      const bad = v.list.find((t) => typeof t !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._+#-]{0,39}$/.test(t));
      if (bad !== undefined) err(fm.lines.tags, `invalid tag "${bad}" (letters, digits, space . _ + # -; max 40 chars)`);
      else if (new Set(v.list).size !== v.list.length) err(fm.lines.tags, 'duplicate tags');
      else out.tags = v.list;
    }
  }
  return { fields: out, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* page rendering                                                      */
/* ------------------------------------------------------------------ */

const GTAG = `    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-92KXYXDDWD"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', 'G-92KXYXDDWD');
    </script>`;

const q = encodeURIComponent;

function chipLink(href, label, cls = '') {
  return `<a class="chip${cls ? ' ' + cls : ''}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function postCard(p) {
  return `<a class="card post-card" href="${escapeHtml(p.slug)}.html">` +
    `<span class="badge">${escapeHtml(p.category)}</span>` +
    `<h3>${escapeHtml(p.title)}</h3>` +
    `<p class="muted small">${escapeHtml(p.summary)}</p>` +
    `<span class="post-meta small muted">${p.readingMinutes} min read</span></a>`;
}

export function relatedPosts(post, all, limit = 3) {
  const mine = new Set(post.tags.map((t) => t.toLowerCase()));
  return all
    .filter((p) => p.slug !== post.slug)
    .map((p) => {
      const shared = p.tags.filter((t) => mine.has(t.toLowerCase())).length;
      return { p, score: shared * 2 + (p.category === post.category ? 1 : 0), shared };
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.score - a.score || a.p.order - b.p.order)
    .slice(0, limit)
    .map((x) => x.p);
}

export function renderPostPage(post, all, { siteUrl = '' } = {}) {
  const idx = all.findIndex((p) => p.slug === post.slug);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;
  const related = relatedPosts(post, all);
  const h2 = post.headings.filter((h) => h.level === 2);
  const title = `${post.title} | ${SITE_NAME}`;
  const url = siteUrl ? `${siteUrl}/blog/${post.slug}.html` : '';

  const meta = [
    `<meta name="description" content="${escapeHtml(post.summary)}">`,
    `<meta property="og:title" content="${escapeHtml(post.title)}">`,
    `<meta property="og:description" content="${escapeHtml(post.summary)}">`,
    '<meta property="og:type" content="article">',
    `<meta property="article:published_time" content="${post.date}">`,
    `<meta property="article:section" content="${escapeHtml(post.category)}">`,
    ...post.tags.map((t) => `<meta property="article:tag" content="${escapeHtml(t)}">`),
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(post.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(post.summary)}">`
  ];
  let extraHead = '';
  if (siteUrl) {
    meta.push(`<meta property="og:url" content="${escapeHtml(url)}">`, `<meta property="og:site_name" content="${SITE_NAME}">`);
    extraHead += `    <link rel="canonical" href="${escapeHtml(url)}">\n`;
    extraHead += `    <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} blog" href="rss.xml">\n`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.summary,
      datePublished: post.date,
      dateModified: post.date,
      articleSection: post.category,
      keywords: post.tags.join(', '),
      wordCount: post.words,
      inLanguage: 'en',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      author: { '@type': 'Organization', name: SITE_NAME },
      publisher: { '@type': 'Organization', name: SITE_NAME }
    };
    extraHead += `    <script type="application/ld+json">\n${jsonForScript(ld)}\n    </script>\n`;
  }

  const toc = h2.length >= 2
    ? `<nav class="toc" id="toc" aria-label="On this page"><details open><summary>On this page</summary><ol>` +
      h2.map((h) => `<li><a href="#${h.id}">${h.html}</a></li>`).join('') + '</ol></details></nav>'
    : '';

  const pn = (prev || next)
    ? '<nav class="post-nav" id="post-nav" aria-label="Previous and next posts">' +
      (prev ? `<a class="card" rel="prev" href="${escapeHtml(prev.slug)}.html"><span class="small muted">&larr; Previous</span><strong>${escapeHtml(prev.title)}</strong></a>` : '<span></span>') +
      (next ? `<a class="card next" rel="next" href="${escapeHtml(next.slug)}.html"><span class="small muted">Next &rarr;</span><strong>${escapeHtml(next.title)}</strong></a>` : '<span></span>') +
      '</nav>'
    : '';

  const rel = related.length
    ? `<section class="related" id="related" aria-labelledby="related-h"><h2 id="related-h">Related posts</h2><div class="grid">${related.map(postCard).join('')}</div></section>`
    : '';

  return `<!doctype html>
<!-- Generated by tools/build-blog.mjs from blog/src/${post.slug}.md. Do not edit by hand. -->
<html lang="en" data-root="../" data-page="blog">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="../favicon.ico" sizes="32x32">
    <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
    ${meta.join('\n    ')}
${extraHead}    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${GTAG}
    <script src="../assets/js/theme.js"></script>
    <link rel="stylesheet" href="../assets/css/site.css">
    <link rel="stylesheet" href="blog.css">
    <script defer src="../assets/js/shell.js"></script>
    <script defer src="blog.js"></script>
</head>

<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div id="site-header"></div>
    <main id="main" class="container">
        <article class="post" data-slug="${escapeHtml(post.slug)}">
            <nav class="crumbs small" aria-label="Breadcrumb"><a href="./">Blog</a> <span aria-hidden="true">/</span> <a href="./?cat=${q(post.category)}">${escapeHtml(post.category)}</a></nav>
            <header class="post-head">
                <h1>${escapeHtml(post.title)}</h1>
                <p class="post-summary">${escapeHtml(post.summary)}</p>
                <p class="post-meta small muted"><time datetime="${post.date}">${formatDate(post.date)}</time> <span aria-hidden="true">&middot;</span> ${post.readingMinutes} min read</p>
                <div class="chips post-chips" aria-label="Category and tags">${chipLink('./?cat=' + q(post.category), post.category, 'chip-cat')}${post.tags.map((t) => chipLink('./?tag=' + q(t), '#' + t)).join('')}</div>
            </header>
            <div class="post-layout">
                ${toc}
                <div class="prose" id="post-content">
${post.html}
                </div>
            </div>
            <aside class="cta card" aria-labelledby="cta-h">
                <h2 id="cta-h">Moving between Android and iOS?</h2>
                <p class="muted">Look up the iOS, Flutter and React Native counterpart of any Android concept, side by side.</p>
                <a class="btn btn-primary" href="../equivalents/">Open the Equivalents page</a>
            </aside>
            ${pn}
            ${rel}
        </article>
    </main>
    <div id="site-footer"></div>
</body>

</html>
`;
}

/* ------------------------------------------------------------------ */
/* feeds                                                               */
/* ------------------------------------------------------------------ */

export function renderRss(posts, siteUrl) {
  const newest = posts.reduce((a, p) => (p.date > a ? p.date : a), posts[0] ? posts[0].date : '1970-01-01');
  const items = [...posts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order - b.order)).map((p) => {
    const link = `${siteUrl}/blog/${p.slug}.html`;
    return `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      <pubDate>${new Date(p.date + 'T00:00:00Z').toUTCString()}</pubDate>
      <category>${xmlEscape(p.category)}</category>
      <description>${xmlEscape(p.summary)}</description>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME} blog</title>
    <link>${xmlEscape(siteUrl + '/blog/')}</link>
    <description>Android engineering notes with iOS counterparts.</description>
    <language>en</language>
    <lastBuildDate>${new Date(newest + 'T00:00:00Z').toUTCString()}</lastBuildDate>
    <atom:link href="${xmlEscape(siteUrl + '/blog/rss.xml')}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function renderSitemap(posts, siteUrl) {
  const urls = [
    { loc: siteUrl + '/' }, { loc: siteUrl + '/components/' }, { loc: siteUrl + '/libraries/' },
    { loc: siteUrl + '/equivalents/' }, { loc: siteUrl + '/blog/' },
    ...[...posts].sort((a, b) => a.order - b.order).map((p) => ({ loc: `${siteUrl}/blog/${p.slug}.html`, lastmod: p.date })),
    { loc: siteUrl + '/iqlist.html' }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

export function renderRobots(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

export function normaliseSiteUrl(raw) {
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { throw new Error(`SITE_URL is not a valid URL: ${raw}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('SITE_URL must be http(s)');
  if (u.search || u.hash) throw new Error('SITE_URL must not include a query or fragment');
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

/* Pure-ish core: takes [{file, text}], returns {posts, errors, warnings}. */
export function compilePosts(sources) {
  const errors = [];
  const warnings = [];
  const posts = [];
  const seen = new Map();

  for (const { file, text } of sources) {
    const fm = parseFrontmatter(text, file);
    const v = validateFrontmatter(fm, file);
    warnings.push(...v.warnings);
    const md = renderMarkdown(fm.body, { file, startLine: fm.bodyStart });
    errors.push(...v.errors, ...md.errors);
    if (!md.html.trim() && !md.errors.length && !v.errors.length) errors.push({ file, line: fm.bodyStart, message: 'post body is empty' });

    const f = v.fields;
    if (f.slug) {
      if (seen.has(f.slug)) errors.push({ file, line: fm.lines.slug, message: `duplicate slug "${f.slug}" (also used by ${seen.get(f.slug)})` });
      else seen.set(f.slug, file);
    }
    if (!v.errors.length && !md.errors.length) {
      posts.push({ ...f, html: md.html, headings: md.headings, words: md.words, readingMinutes: readingMinutes(md.words), file });
    }
  }

  const orders = new Map();
  for (const p of posts) {
    if (orders.has(p.order)) warnings.push({ file: p.file, line: 1, message: `order ${p.order} is also used by ${orders.get(p.order)}` });
    else orders.set(p.order, p.file);
  }
  posts.sort((a, b) => a.order - b.order || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slug < b.slug ? -1 : 1));
  return { posts, errors, warnings };
}

export function postsIndex(posts) {
  return posts.map((p) => ({
    slug: p.slug, title: p.title, date: p.date, order: p.order, category: p.category,
    tags: p.tags, summary: p.summary, readingMinutes: p.readingMinutes
  }));
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (['--src', '--out', '--root'].includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (opts.help) {
    console.log('usage: node tools/build-blog.mjs [--src DIR] [--out DIR] [--root DIR] [--check]\n' +
      '  --src   Markdown directory (default <root>/blog/src)\n  --out   output directory (default <root>/blog)\n' +
      '  --root  site root for sitemap.xml/robots.txt (default: repo root)\n  --check validate only, write nothing\n' +
      '  env SITE_URL=https://example.com[/base]  enables canonical/og:url/JSON-LD/rss/sitemap/robots');
    return 0;
  }
  let siteUrl;
  try { siteUrl = normaliseSiteUrl(env.SITE_URL); } catch (e) { console.error(e.message); return 2; }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.resolve(opts.root || repoRoot);
  const src = path.resolve(opts.src || path.join(root, 'blog', 'src'));
  const out = path.resolve(opts.out || path.join(root, 'blog'));

  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) { console.error(`source directory not found: ${src}`); return 2; }
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.md')).sort();
  const rel = (f) => path.relative(process.cwd(), path.join(src, f)) || f;
  const sources = files.map((f) => ({ file: rel(f), text: fs.readFileSync(path.join(src, f), 'utf8') }));

  const { posts, errors, warnings } = compilePosts(sources);
  for (const w of warnings) console.warn(`warning ${w.file}:${w.line}: ${w.message}`);
  if (errors.length) {
    errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    for (const e of errors) console.error(`${e.file}:${e.line}: error: ${e.message}`);
    console.error(`\n${errors.length} error(s) in ${new Set(errors.map((e) => e.file)).size} file(s). Nothing was written.`);
    return 1;
  }
  if (!posts.length) { console.error('no posts found in ' + src); return 1; }
  if (opts.check) { console.log(`OK: ${posts.length} post(s) valid. Nothing written (--check).`); return 0; }

  fs.mkdirSync(out, { recursive: true });
  const written = [];
  const write = (file, content) => { fs.writeFileSync(file, content); written.push(path.relative(process.cwd(), file)); };

  for (const p of posts) write(path.join(out, p.slug + '.html'), renderPostPage(p, posts, { siteUrl }));
  write(path.join(out, 'posts.json'), JSON.stringify(postsIndex(posts), null, 2) + '\n');
  if (siteUrl) {
    write(path.join(out, 'rss.xml'), renderRss(posts, siteUrl));
    write(path.join(root, 'sitemap.xml'), renderSitemap(posts, siteUrl));
    write(path.join(root, 'robots.txt'), renderRobots(siteUrl));
  }

  // report generated pages whose source post no longer exists (never deleted automatically)
  const slugs = new Set(posts.map((p) => p.slug));
  for (const f of fs.readdirSync(out)) {
    if (!f.endsWith('.html') || f === 'index.html' || slugs.has(f.slice(0, -5))) continue;
    try {
      if (fs.readFileSync(path.join(out, f), 'utf8').includes('Generated by tools/build-blog.mjs')) {
        console.warn(`warning: ${path.relative(process.cwd(), path.join(out, f))} is a generated page with no source post; delete it if the post was removed`);
      }
    } catch { /* ignore */ }
  }

  console.log(`Built ${posts.length} post(s) -> ${path.relative(process.cwd(), out) || '.'}` +
    (siteUrl ? ` (SITE_URL=${siteUrl})` : ' (no SITE_URL: canonical/RSS/sitemap/robots skipped)'));
  console.log(written.length + ' file(s) written');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
