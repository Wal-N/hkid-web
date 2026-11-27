import assert from 'node:assert/strict';
import { expect } from 'playwright/test';

const pagePaths = ['/hkid-web/', '/hkid-web/zh-hk/'];

function tabShine(tab) {
  return tab.evaluate(button => {
    const face = getComputedStyle(button);
    const rim = getComputedStyle(button, '::after');
    const tracking = parseFloat(face.getPropertyValue('--shine-x')) >= 0;
    return {
      face: tracking && face.backgroundImage !== 'none',
      rim: tracking && rim.content !== 'none' && rim.display !== 'none' && rim.backgroundImage !== 'none',
      brightened: face.filter !== 'none',
    };
  });
}

export async function checkTabHoverDuringSlide(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  try {
    await page.goto(new URL(pagePaths[0], origin).href);
    await page.locator('#sample-content:not([inert])').waitFor();
    // Stretch the real transition so the mouse can enter before the glass arrives.
    await page.addStyleTag({ content: '.tabs { --tab-slide: 2s linear; }' });
    const generate = page.locator('#tab-generate');
    const validate = page.locator('#tab-validate');
    const lit = { face: true, rim: true, brightened: true };

    async function switchAndHover(tab, min, max) {
      await tab.click();
      await page.mouse.move(0, 0);
      await tab.hover({ position: { x: 22, y: 3 } });
      await page.waitForFunction(([min, max]) => {
        const tabs = document.querySelector('.tabs');
        const glass = getComputedStyle(tabs, '::after').transform;
        const offset = new DOMMatrixReadOnly(glass).m41 / tabs.querySelector('.tab').getBoundingClientRect().width;
        return offset > min && offset < max;
      }, [min, max]);
      assert.deepEqual(await tabShine(tab), { face: false, rim: false, brightened: false });
    }

    await switchAndHover(validate, .4, .6);
    await expect.poll(() => tabShine(validate)).toEqual(lit);
    await switchAndHover(generate, .4, .6);
    // Reverse mid-slide. Completion of the previous trip must not expose the new tab.
    await switchAndHover(validate, .7, .85);
    await expect.poll(() => tabShine(validate)).toEqual(lit);
  } finally {
    await page.close();
  }
}

async function checkFirstPaint(browser, url, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  let releaseWasm;
  const pending = new Promise(resolve => { releaseWasm = resolve; });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      let score = 0;
      function add(entries) {
        for (const entry of entries) if (!entry.hadRecentInput) score += entry.value;
      }
      const observer = new PerformanceObserver(list => add(list.getEntries()));
      observer.observe({ type: 'layout-shift', buffered: true });
      window.readInitialLayoutShift = () => {
        add(observer.takeRecords());
        return score;
      };
    });
    await page.route('**/hkid_web_core_bg.wasm', async route => {
      await pending;
      await route.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#core-status').waitFor();
    assert.ok(await page.locator('#sample-content').evaluate(el => el.inert));
    // Let the loading layout paint as it would on a slower connection.
    await page.waitForTimeout(500);
    releaseWasm();
    await page.locator('#sample-content:not([inert])').waitFor();
    const score = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.readInitialLayoutShift();
    });
    assert.ok(score <= 0.1, `${url} at ${width}px: initial layout shift ${score}`);
  } finally {
    releaseWasm();
    await context.close();
  }
}

async function checkLargeText(browser, url) {
  const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
    await page.goto(url);
    await page.locator('#sample-content:not([inert])').waitFor();
    const measurements = await page.evaluate(() => {
      const dates = [...document.querySelectorAll('[data-format]')];
      const clipped = dates.filter(label => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const field = label.closest('.field').getBoundingClientRect();
        return [...range.getClientRects()].some(rect => rect.left < field.left - 1 || rect.right > field.right + 1);
      });
      const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
      const switcher = document.querySelector('#locale-switch').getBoundingClientRect();
      return {
        font: getComputedStyle(document.documentElement).fontSize, dates: dates.length,
        clipped: clipped.map(label => label.textContent), switcherFits: switcher.right <= toolbar.right + 1,
      };
    });
    assert.deepEqual(measurements, { font: '32px', dates: 3, clipped: [], switcherFits: true }, url);
  } finally {
    await context.close();
  }
}

async function expectFooterCounts(page, english, visitors, generated) {
  await expect(page.locator('#stats-visitors')).toHaveText(english ? `Visitors: ${visitors}` : `累計訪客 ${visitors} 人`);
  await expect(page.locator('#stats-generated')).toHaveText(english ? `HKIDs generated: ${generated}` : `已生成 ${generated} 筆 HKID`);
  await expect(page.locator('#stats-totals')).not.toContainText(/Statistics pending|統計待更新/);
}

async function checkPageWithoutScripts(browser, url) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(url);
    assert.ok((await page.locator('#generate-status').innerText()).includes('JavaScript'));
    assert.equal(await page.locator('#core-status').isVisible(), false);
    await expectFooterCounts(page, new URL(url).pathname === pagePaths[0], '—', '—');
    await page.locator('#privacy summary').click();
    assert.match(await page.locator('#privacy').innerText(), /Google Analytics 4/);
    assert.ok(await page.locator('#privacy a').isVisible());
  } finally {
    await context.close();
  }
}

export async function checkPrivacyMotion(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 900 } });
  try {
    await page.goto(new URL(pagePaths[1], origin).href);
    const details = page.locator('#privacy');
    const summary = details.locator('summary');
    const { closed, open, closedAgain } = await details.evaluate(element => {
      const summary = element.querySelector('summary');
      const height = () => element.getBoundingClientRect().height;
      const closed = height();
      summary.click();
      const open = height();
      summary.click();
      return { closed, open, closedAgain: height() };
    });
    assert.ok(open > closed + 2, 'Reduced motion expands the disclosure immediately');
    assert.equal(closedAgain, closed, 'Reduced motion collapses the disclosure immediately');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await summary.scrollIntoViewIfNeeded();
    // Resolve the normal-motion style and check that the site enables the transition.
    const duration = await details.evaluate(element => getComputedStyle(element, '::details-content').transitionDuration);
    assert.ok(parseFloat(duration) > 0, 'Normal motion animates the disclosure');
    // Give slower runners time to sample the middle of the real CSS transition.
    await page.addStyleTag({ content: '#privacy::details-content { --privacy-duration: 1s; }' });
    expect(await details.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(closed, 1);

    async function toggle(key, expectedHeight, reverse = false) {
      await Promise.all([
        page.waitForFunction(({ closed, open, reverse }) => {
          const details = document.querySelector('#privacy');
          const progress = (details.getBoundingClientRect().height - closed) / (open - closed);
          if (progress < 0.25 || progress > 0.75) return false;
          if (!details.open) {
            const link = details.querySelector('a');
            link.focus({ preventScroll: true });
            if (document.activeElement === link) throw new Error('A closing disclosure link took focus');
          }
          if (reverse) details.querySelector('summary').click();
          return true;
        }, { closed, open, reverse }, { timeout: 3000 }),
        summary.press(key),
      ]);
      await expect.poll(() => details.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(expectedHeight, 1);
      await expect(details).toHaveJSProperty('open', expectedHeight === open);
    }
    await toggle('Enter', open);
    await toggle('Space', closed);
    await toggle('Enter', closed, true);
  } finally {
    await page.close();
  }
}

export async function checkLayout(browser, origin) {
  for (const path of pagePaths) {
    const url = new URL(path, origin).href;
    for (const width of [390, 1280]) await checkFirstPaint(browser, url, width);
    await checkLargeText(browser, url);
    await checkPageWithoutScripts(browser, url);
  }
}

async function measureFooterContrast(page) {
  const footer = page.locator('.site-stats');
  const labels = '.site-stats [data-i18n]';
  const hideInk = `${labels} { -webkit-text-fill-color: transparent; text-decoration-color: transparent; }`;
  const capture = async style => (await footer.screenshot({ style, scale: 'css' })).toString('base64');
  // Paint a solid swatch of each label's text color in the second capture.
  // Sampling the same position avoids antialiasing and includes the real backdrop.
  const background = await capture(hideInk);
  const foreground = await capture(hideInk + `${labels} { background: currentColor !important; }`);
  return footer.evaluate(async (root, { labels, background, foreground }) => {
    async function pixels(encoded) {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d');
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    }
    const [bg, fg] = await Promise.all([pixels(background), pixels(foreground)]);
    const origin = root.getBoundingClientRect();
    function luminance(image, x, y) {
      const offset = 4 * (image.width * y + x);
      const [r, g, b] = Array.from(image.data.slice(offset, offset + 3), byte => {
        const c = byte / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    }
    const ratios = {};
    for (const label of root.querySelectorAll(labels)) {
      const range = document.createRange();
      range.selectNodeContents(label);
      const key = label.id || label.dataset.i18n;
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const x = Math.floor(rect.left + rect.width / 2 - origin.left);
        for (const inset of [1, rect.height / 2, rect.height - 1]) {
          const y = Math.floor(rect.top + inset - origin.top);
          const a = luminance(bg, x, y);
          const b = luminance(fg, x, y);
          const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          ratios[key] = Math.min(ratios[key] ?? Infinity, ratio);
        }
      }
    }
    return ratios;
  }, { labels, background, foreground });
}

export async function checkPortraitFooterContrast(browser, origin) {
  for (const viewport of [{ width: 900, height: 1600 }, { width: 1440, height: 2560 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      for (const path of pagePaths) {
        // Exercise missing and published totals even when the build includes a live report.
        const published = viewport.width === 1440;
        await page.route('**/stats.json', route => route.fulfill({
          json: published ? { visitors: 1, generated: 123, through: '2026-11-24' } : {},
        }), { times: 1 });
        await page.goto(new URL(path, origin).href);
        await page.locator('#sample-content:not([inert])').waitFor();
        const visitors = page.locator('#stats-visitors');
        const generated = page.locator('#stats-generated');
        const english = path === pagePaths[0];
        if (published) {
          await expectFooterCounts(page, english, '1', '123');
          const tooltip = english
            ? 'Google Analytics takes time to process data, so these totals may not yet include recent activity.'
            : 'Google Analytics 處理數據需時，最近的統計數據可能尚未計入。';
          for (const total of [visitors, generated]) {
            await total.hover();
            await expect(total).toHaveAttribute('title', tooltip);
          }
        } else {
          await expectFooterCounts(page, english, '—', '—');
          await expect(visitors).toHaveJSProperty('title', '');
          await expect(generated).toHaveJSProperty('title', '');
        }
        assert.doesNotMatch(await page.locator('#stats-totals').innerText(), /Through|統計至|2026/);
        for (const mode of ['generate', 'validate']) {
          await page.locator('#tab-' + mode).click();
          const layout = await page.locator('footer.site-stats').evaluate(footer => {
            const card = document.getElementById('tool-card');
            const style = getComputedStyle(footer);
            const painted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none';
            return {
              belowCard: !card.contains(footer) && footer.getBoundingClientRect().top > card.getBoundingClientRect().bottom,
              roundedBackground: painted && style.borderRadius !== '0px',
              boxedBorder: ['Top', 'Right', 'Bottom', 'Left'].every(side => parseFloat(style['border' + side + 'Width']) > 0),
              shadow: style.boxShadow,
            };
          });
          assert.deepEqual(layout, { belowCard: true, roundedBackground: false, boxedBorder: false, shadow: 'none' },
            `${path} ${mode} ${viewport.width}x${viewport.height} footer placement and appearance`);
          await page.locator('#privacy summary').click();
          if (mode === 'validate') await page.locator('.github-link').hover();
          const ratios = await measureFooterContrast(page);
          for (const key of ['stats-visitors', 'stats-generated', 'feedbackLink', 'privacy',
            'privacyLocal', 'privacyAnalytics', 'privacyLink']) {
            const ratio = ratios[key];
            assert.ok(ratio >= 4.5, `${path} ${mode} ${viewport.width}x${viewport.height} ${key}: ${ratio}:1`);
          }
          await page.locator('#privacy summary').click();
        }
      }
    } finally {
      await context.close();
    }
  }
}
