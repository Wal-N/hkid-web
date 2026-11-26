import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';
import { expect } from 'playwright/test';
import { createPreviewServer } from './preview.mjs';
import { checkLayout, checkPortraitFooterContrast } from './test-browser-layout.mjs';

const site = createPreviewServer(resolve(process.argv[2] || 'dist'));
let origin;
before(async () => {
  site.listen(0, '127.0.0.1');
  await once(site, 'listening');
  origin = 'http://127.0.0.1:' + site.address().port;
});
after(() => new Promise(resolve => site.close(resolve)));

const entries = [
  { lang: 'en', path: '/hkid-web/', width: 1280 },
  { lang: 'zh-HK', path: '/hkid-web/zh-hk/', width: 390 },
];

async function exerciseTools(browser, entry, other) {
  const context = await browser.newContext({
    viewport: { width: entry.width, height: 900 }, reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const issues = [];
    const requests = [];
    page.on('pageerror', error => issues.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) issues.push(response.status() + ' ' + response.url());
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.origin === origin) return route.continue();
      issues.push('Unexpected external request to ' + url.origin);
      return route.abort();
    });
    // Exercise the copy handler without touching the developer's system clipboard.
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async value => { window.copiedText = value; } },
    }));
    await page.goto(origin + entry.path);
    const number = page.locator('[data-copy="number"] [data-value]');
    const summary = page.locator('[data-copy="summary"] [data-value]');
    await expect(number).toHaveText(/^[A-Z]{1,2}\d{6}\([\dA]\)$/);
    const sample = await number.textContent();
    const initialSummary = await summary.textContent();
    await expect(page.locator('html')).toHaveAttribute('lang', entry.lang);
    await page.waitForLoadState('networkidle');
    const initialRequests = requests.length;
    const buttons = page.locator('[data-copy]');
    await expect(buttons).toHaveCount(10);
    for (const button of await buttons.all()) {
      const value = await button.locator('[data-value]').textContent();
      assert.ok(value);
      await button.click();
      assert.equal(await page.evaluate(() => window.copiedText), value);
    }

    await page.locator('#tab-validate').click();
    const input = page.locator('#number-input');
    const result = page.locator('#validation-result');
    for (const [raw, status, detail] of [
      [sample, 'valid', sample], ['Ａ 123456 （３）', 'valid', 'A123456(3)'],
      ['A000002(A)', 'valid', 'A000002(A)'], ['A123456(4)', 'incorrect'],
      ['A12X456(3)', 'invalid'], ['', 'empty'], ['BC987654', 'missing', '8'],
    ]) {
      await input.fill(raw);
      await expect(result).toBeHidden();
      await input.press('Enter');
      await expect(result).toHaveAttribute('data-status', status);
      if (detail) await expect(page.locator('#result-detail')).toContainText(detail);
    }
    await page.locator('#locale-switch').click();
    await expect(page).toHaveURL(origin + other.path);
    await expect(page.locator('html')).toHaveAttribute('lang', other.lang);
    await expect(input).toHaveValue('BC987654');
    await expect(result).toHaveAttribute('data-status', 'missing');
    await page.locator('#tab-generate').click();
    await expect(number).toHaveText(sample);
    await expect(summary).not.toHaveText(initialSummary);
    await page.goBack();
    await expect(summary).toHaveText(initialSummary);
    await page.locator('#regenerate').click();
    await expect(page.locator('#live-feedback')).toHaveText(entry.lang === 'en' ? 'New test sample generated' : '已生成測試樣本');
    const nextNumber = await number.textContent();
    await page.locator('#tab-validate').click();
    await input.fill(nextNumber);
    await page.locator('#check-number').click();
    await expect(result).toHaveAttribute('data-status', 'valid');
    await page.locator('#clear-input').click();
    await expect(input).toHaveValue('');
    await expect(result).toBeHidden();
    assert.deepEqual(requests.slice(initialRequests), []);
    assert.deepEqual(issues, []);
  } finally {
    await context.close();
  }
}

for (const engine of [chromium, firefox, webkit]) {
  test(engine.name() + ' runs the built Pages site', async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    for (const entry of entries) {
      const other = entries.find(candidate => candidate !== entry);
      await t.test(entry.lang + ' generation, validation, copy and navigation', () => exerciseTools(browser, entry, other));
    }
    if (engine === chromium) {
      await t.test('initial layout, enlarged text and privacy disclosure', () => checkLayout(browser, origin));
      await t.test('portrait footer text meets 4.5:1 contrast in both tools and languages', () => checkPortraitFooterContrast(browser, origin));
    }
    await t.test('retry loads the real WASM after a failed download', async () => {
      const page = await browser.newPage();
      try {
        await page.route('**/hkid_web_core_bg.wasm', route => route.abort(), { times: 1 });
        await page.goto(origin + entries[1].path);
        await page.locator('#retry-core').click();
        await expect(page.locator('#regenerate')).toBeEnabled();
        await expect(page.locator('[data-copy="number"] [data-value]')).toHaveText(/\([\dA]\)$/);
      } finally {
        await page.close();
      }
    });
  });
}
