import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const site = 'https://wal-n.github.io/hkid-web/';
const pages = [
  { lang: 'en', path: '', title: 'Hong Kong Identity Card Checker & Generator', description: /sample.+check digit/i },
  { lang: 'zh-HK', path: 'zh-hk/', title: '香港身份證號碼驗證及生成器', description: /測試資料.+安全.+校驗碼/ },
];

function attributes(source) {
  const values = source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g);
  return Object.fromEntries(Array.from(values, ([, key, double, single, bare]) => [key, double ?? single ?? bare ?? '']));
}

function tags(html) {
  return Array.from(html.matchAll(/<([\w-]+)\b([^>]*)>/g), ([, tagName, source]) => ({ tagName, ...attributes(source) }));
}

test('language entry pages are discoverable and expose the same fields', async () => {
  const structures = [];
  for (const page of pages) {
    const html = await readFile(new URL('../' + page.path + 'index.html', import.meta.url), 'utf8');
    const elements = tags(html);
    const head = tags(html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)[1]);
    const links = head.filter(tag => tag.tagName === 'link');
    const analytics = head[0];
    assert.deepEqual(analytics, {
      tagName: 'script', type: 'module', src: '/hkid-web/analytics.js',
      'data-google-tag-src': 'https://www.googletagmanager.com/gtm.js?id=GTM-MTSLZZ7V',
    });
    const loaders = elements.filter(tag => tag.tagName === 'script' && (
      tag.src === analytics.src || 'data-google-tag-src' in tag || tag.src?.includes('googletagmanager.com/')
    ));
    assert.equal(loaders.length, 1);
    assert.equal(elements.find(tag => tag.tagName === 'html').lang, page.lang);
    assert.equal(html.match(/<title\b[^>]*>(.*?)<\/title>/s)[1].trim().replaceAll('&amp;', '&'), page.title);
    assert.match(head.find(tag => tag.tagName === 'meta' && tag.name === 'description')?.content ?? '', page.description);
    assert.deepEqual(links.filter(link => link.rel === 'canonical').map(link => link.href), [site + page.path]);
    for (const version of pages) {
      assert.deepEqual(links.filter(link => link.rel === 'alternate' && link.hreflang === version.lang)
        .map(link => link.href), [site + version.path]);
    }
    const other = pages.find(version => version.lang !== page.lang);
    const switcher = elements.find(tag => tag.id === 'locale-switch');
    assert.equal(switcher.tagName, 'a');
    assert.equal(new URL(switcher.href, site + page.path).href, site + other.path);
    assert.equal(switcher.hreflang, other.lang);
    const visibleLanguage = html.match(/<span data-i18n="language">([^<]+)<\/span>/)[1];
    assert.ok(switcher['aria-label'].includes(visibleLanguage));

    const privacy = html.match(/<details id="privacy">([\s\S]*?)<\/details>/)[1];
    assert.match(privacy, /<summary\b[^>]*>[^<]+<\/summary>/);
    assert.match(privacy, /Google Analytics 4/);
    assert.match(privacy, /https:\/\/policies\.google\.com\/technologies\/partner-sites/);

    const fields = [];
    for (const [, source, content] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const field = attributes(source)['data-copy'];
      if (!field) continue;
      fields.push(field);
      const children = tags(content);
      const values = children.filter(tag => 'data-value' in tag);
      assert.equal(values.length, 1, field);
      assert.ok(['span', 'div', 'section'].includes(values[0].tagName) && 'data-nosnippet' in values[0], field);
      // renderCard writes textContent here, so field labels must live outside this element.
      assert.match(content, /<(span|div|section)\b[^>]*\sdata-value\b[^>]*>[^<]*<\/\1>/, field);
      assert.ok(children.some(tag => tag['data-i18n'] === field && !('data-nosnippet' in tag)), field);
    }
    assert.ok(fields.includes('number') && fields.includes('summary'));
    assert.equal(elements.filter(tag => 'data-nosnippet' in tag).length, fields.length);
    structures.push({ fields: fields.sort(), labels: elements.map(tag => tag['data-i18n']).filter(Boolean).sort() });
  }
  assert.deepEqual(structures[0], structures[1]);
});
