import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as settle } from 'node:timers/promises';

const production = 'https://wal-n.github.io/hkid-web/';
const config = {
  hostname: 'wal-n.github.io', pagePath: '/hkid-web/',
  measurementId: 'G-PE5SLFMXFY', destinationId: 'G-PE5SLFMXFY',
};
const containerUrl = 'https://www.googletagmanager.com/gtm.js?id=GTM-MTSLZZ7V';
let moduleNumber = 0;

async function mockPage(t, {
  url = production, webdriver = false, getConfig = async () => config, hasContainer = true,
} = {}) {
  const requests = [];
  const scripts = [];
  const window = {};
  const globals = {
    window, location: new URL(url), navigator: { webdriver },
    document: {
      title: 'private-text-in-title',
      referrer: 'https://example.test/private-text-in-referrer',
      querySelector: selector => selector === 'script[data-google-tag-src]' && hasContainer
        ? { dataset: { googleTagSrc: containerUrl } } : null,
      createElement: () => ({}),
      head: { append: script => scripts.push(script) },
    },
    fetch: async (address, options) => {
      requests.push({ address, options });
      return { ok: true, json: getConfig };
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const { recordGeneration } = await import('../analytics.js?test=' + ++moduleNumber);
  return { recordGeneration, requests, scripts, commands: () => Array.from(window.dataLayer ?? [], args => [...args]) };
}

for (const [scenario, settings] of [
  ['loopback', { url: 'http://127.0.0.1:4173/hkid-web/' }],
  ['another Pages project', { url: 'https://wal-n.github.io/other/' }],
  ['an unrelated path under a locale', { url: production + 'zh-hk/other/' }],
  ['automated browser', { webdriver: true }],
]) {
  test(scenario + ' never requests analytics', async t => {
    const page = await mockPage(t, settings);
    page.recordGeneration();
    await settle();
    assert.equal(page.requests.length, 0);
    assert.equal(page.scripts.length, 0);
    assert.deepEqual(page.commands(), []);
  });
}

for (const path of ['zh-hk/', 'zh-hk/index.html', 'zh-hk']) {
  test(path + ' reports against the shared project URL', async t => {
    const page = await mockPage(t, { url: production + path + '?id=private-text#private-text' });
    await settle();
    page.scripts[0].onload();
    page.recordGeneration();
    await settle();
    const commands = page.commands();
    const settings = commands.find(([command]) => command === 'config')[2];
    assert.equal(settings.page_location, production);
    assert.doesNotMatch(JSON.stringify(commands), /private-text/);
    assert.deepEqual(commands.filter(([command]) => command === 'event').map(([, name]) => name),
      ['page_view', 'hkid_generated']);
  });
}

test('only the canonical page and successful generations are queued while config and tag load', async t => {
  let releaseConfig;
  const delayed = new Promise(resolve => { releaseConfig = resolve; });
  const page = await mockPage(t, {
    url: production + 'index.html?id=private-text-in-query#private-text-in-fragment',
    getConfig: () => delayed,
  });
  page.recordGeneration();
  releaseConfig(config);
  await settle();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].options.referrerPolicy, 'no-referrer');
  assert.equal(page.scripts.length, 1);
  const [script] = page.scripts;
  assert.equal(script.src, containerUrl);
  assert.equal(script.referrerPolicy, 'no-referrer');
  const initial = page.commands();
  assert.deepEqual(initial.map(([command]) => command), ['consent', 'set', 'js', 'config', 'event']);
  assert.deepEqual(initial[0], ['consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  }]);
  assert.deepEqual(initial[1][1], initial[3][2]);
  page.recordGeneration();
  script.onload();
  await settle();
  page.recordGeneration();
  await settle();
  const commands = page.commands();
  const [, stream, settings] = commands.find(([command]) => command === 'config');
  assert.equal(stream, config.measurementId);
  assert.equal(settings.send_page_view, false);
  assert.equal(settings.page_location, production);
  assert.equal(settings.page_referrer, '');
  assert.equal(settings.page_title, 'HKID');
  assert.equal(settings.allow_google_signals, false);
  assert.equal(settings.allow_ad_personalization_signals, false);
  assert.doesNotMatch(JSON.stringify(commands), /private-text/);
  const events = commands.filter(([command]) => command === 'event');
  assert.deepEqual(events.map(([, name]) => name), ['page_view', 'hkid_generated', 'hkid_generated', 'hkid_generated']);
  for (const [, , payload] of events) assert.deepEqual(payload, { send_to: config.measurementId });
});

for (const [scenario, getConfig] of [
  ['disabled config', () => ({ ...config, measurementId: null })],
  ['a different GA4 destination', () => ({ ...config, measurementId: 'G-OTHER123' })],
  ['unavailable config', () => { throw new Error('offline'); }],
]) {
  test(scenario + ' skips the tag', async t => {
    const page = await mockPage(t, { getConfig });
    page.recordGeneration();
    await settle();
    assert.equal(page.scripts.length, 0);
    assert.deepEqual(page.commands(), []);
  });
}

test('a page without the container declaration skips collection', async t => {
  const page = await mockPage(t, { hasContainer: false });
  page.recordGeneration();
  await settle();
  assert.equal(page.scripts.length, 0);
  assert.deepEqual(page.commands(), []);
});

test('a blocked tag discards queued and subsequent generations', async t => {
  const page = await mockPage(t);
  await settle();
  page.recordGeneration();
  page.scripts[0].onerror(new Error('blocked'));
  page.recordGeneration();
  await settle();
  assert.equal(page.commands().filter(([, name]) => name === 'hkid_generated').length, 0);
});
