// Optional statistics must not hold up the tools if a content blocker rejects a module.
const analytics = import('./analytics.js').catch(() => undefined);
let publicStats;

const messages = {
  'zh-HK': {
    title: '香港身份證號碼驗證及生成器', language: 'English', switchLabel: 'Switch to English',
    tabsLabel: '工具', generate: '生成', validate: '驗證', sample: '香港身份證資料範例',
    enterNumber: '輸入香港身份證號碼',
    description: '生成完整香港身份證測試資料，包括號碼、姓名及出生日期。亦可在瀏覽器內安全檢查號碼格式及校驗碼，毋須上傳號碼。',
    feedbackLink: '建議及問題回報',
    privacy: '私隱及用量統計',
    privacyLocal: '你輸入的身份證號碼及生成的樣本資料只會保留在你的瀏覽器內。',
    privacyAnalytics: '本網站啟用 Google Analytics 4 時，會記錄網頁瀏覽及成功生成樣本的次數，包括每次開頁時生成的第一筆樣本。Google 會收到 IP 位址等連線資料，並可使用 Cookie 和瀏覽器識別碼估算訪客人數。頁尾顯示整體統計數字。',
    privacyLink: 'Google 如何使用來自合作夥伴網站的資料',
    visitorsPending: '累計訪客 —', generatedPending: '已生成 HKID —', statsPending: '統計待更新',
    tapToCopy: '點按資料即可複製', number: '身份證號碼', chineseName: '中文姓名',
    englishName: '英文姓名', birthDate: '出生日期', sex: '性別', commercialCodes: '中文電碼',
    symbols: '證件符號', firstRegistration: '首次登記年月', registrationDate: '登記日期',
    summary: '持有人摘要', notice: '範例號碼可能與他人的身份證號碼相同。', regenerate: '再生成',
    check: '驗證', onDevice: '本機驗證，號碼不會上傳', retry: '再試', loading: '載入中…',
    loadError: '工具載入失敗。', generateError: '未能生成測試樣本。',
    generated: '已生成測試樣本', copied: '已複製', copyFailed: '複製失敗',
    placeholder: '例如 A123456(3)', clear: '清除號碼',
    valid: '格式及校驗碼相符', missing: '欠校驗碼', incorrect: '校驗碼不符',
    invalid: '號碼格式錯誤', empty: '請輸入身份證號碼', checkError: '未能驗證，請再試。',
    calculated: '計算值',
  },
  en: {
    title: 'Hong Kong Identity Card Checker & Generator', language: '繁中', switchLabel: '切換至繁中',
    tabsLabel: 'Tools', generate: 'Generate', validate: 'Validate', sample: 'Sample Hong Kong ID details',
    enterNumber: 'Enter a Hong Kong ID number',
    description: 'Generate a sample Hong Kong ID number and a full set of card details. Securely check a number’s format and check digit in your browser without uploading it.',
    feedbackLink: 'Feedback & bug reports',
    privacy: 'Privacy and analytics',
    privacyLocal: 'The HKID numbers you enter and the sample card details you generate stay in your browser.',
    privacyAnalytics: 'When enabled, Google Analytics 4 counts visits and successful sample generations, including the first sample on each visit. Google receives connection information such as your IP address and can use cookies and browser identifiers to estimate visitor numbers. The footer shows the totals.',
    privacyLink: 'How Google uses data from partner sites',
    visitorsPending: 'Visitors —', generatedPending: 'HKIDs generated —', statsPending: 'Statistics pending',
    tapToCopy: 'Tap a value to copy', clickToCopy: 'Click a value to copy', number: 'HKID number',
    chineseName: 'Chinese name', englishName: 'English name', birthDate: 'Date of birth',
    sex: 'Sex', commercialCodes: 'Commercial codes', symbols: 'Card symbols',
    firstRegistration: 'First registration', registrationDate: 'Date of registration',
    summary: 'Holder summary', notice: 'This sample number may match someone’s HKID.', regenerate: 'Regenerate',
    check: 'Check', onDevice: 'On-device check · No upload', retry: 'Retry', loading: 'Loading…',
    loadError: 'Couldn’t load the tools.', generateError: 'Couldn’t generate a test sample.',
    generated: 'New test sample generated', copied: 'Copied', copyFailed: 'Copy failed',
    placeholder: 'e.g. A123456(3)', clear: 'Clear number',
    valid: 'Valid format and check digit', missing: 'Check digit missing',
    incorrect: 'Incorrect check digit', invalid: 'Invalid number format',
    empty: 'Enter an HKID number', checkError: 'Couldn’t check the number. Try again.',
    calculated: 'Calculated digit',
  },
};

const byId = id => document.getElementById(id);
const modes = ['generate', 'validate'];
const copyButtons = [...document.querySelectorAll('[data-copy]')];
const motionAllowed = matchMedia('(prefers-reduced-motion: no-preference)');
const localeSwitch = byId('locale-switch');
const localePages = Object.fromEntries(
  [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
    .map(link => [link.hreflang, new URL(link.href)])
);
const tabList = document.querySelector('[role="tablist"]');
const regenerateButton = byId('regenerate');
const toolCard = byId('tool-card');
const input = byId('number-input');
const dateInHongKong = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
});
function referenceDate() {
  const parts = Object.fromEntries(dateInHongKong.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

let locale = document.documentElement.lang;
let mode = 'generate';
let card = null;
let validation = null;
let validationSequence = 0;
let core;
let coreReady = false;
let moduleAttempts = 0;
let busy = false;
let issue = null;
let copySequence = 0;
let feedbackTimeout;
let copyFade;
let cardResize;
let refreshAngle = 0;
const t = key => messages[locale][key];

function renderCard() {
  if (card) {
    for (const button of copyButtons) {
      const field = button.dataset.copy;
      button.querySelector('[data-value]').textContent =
        field === 'summary' ? card.summaries[locale] : card[field];
    }
  }
  byId('sample-content').inert = !card;
}

function renderValidation() {
  const box = byId('validation-result');
  box.hidden = !validation;
  input.removeAttribute('aria-invalid');
  if (!validation) {
    delete box.dataset.status;
    byId('result-title').textContent = '';
    byId('result-detail').textContent = '';
    return;
  }
  const {status, number, digit} = validation;
  box.dataset.status = status === 'checkError' ? 'invalid' : status;
  if (['empty', 'invalid', 'incorrect'].includes(status)) input.setAttribute('aria-invalid', 'true');
  byId('result-title').textContent = t(status);
  const detail = status === 'valid' ? number : status === 'missing' ? `${t('calculated')} ${digit}` : '';
  byId('result-detail').textContent = detail;
  byId('result-detail').hidden = !detail;
}

function renderControls() {
  const status = byId('core-status');
  status.hidden = coreReady && !(issue === 'generateError' && mode === 'generate');
  byId('copy-hint').hidden = !card || !status.hidden;
  byId('core-message').textContent = t(issue || 'loading');
  byId('retry-core').hidden = !issue;
  byId('retry-core').disabled = busy;
  regenerateButton.disabled = busy || !coreReady;
  byId('check-number').disabled = !coreReady;
  byId('clear-input').hidden = input.value.length === 0;
}

function renderLocale() {
  document.documentElement.lang = locale;
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('description');
  document.querySelector('link[rel="canonical"]').href = localePages[locale].href;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.dataset.i18n;
    const desktopHint = key === 'tapToCopy' && locale === 'en' && matchMedia('(pointer: fine)').matches;
    node.textContent = t(desktopHint ? 'clickToCopy' : key);
  }
  for (const node of document.querySelectorAll('[data-format]')) {
    const format = node.dataset.format;
    node.textContent = locale === 'zh-HK' ? `（${format}）` : ` (${format})`;
  }
  const otherLocale = locale === 'en' ? 'zh-HK' : 'en';
  localeSwitch.lang = otherLocale;
  localeSwitch.hreflang = otherLocale;
  localeSwitch.pathname = localePages[otherLocale].pathname;
  localeSwitch.setAttribute('aria-label', t('switchLabel'));
  tabList.setAttribute('aria-label', t('tabsLabel'));
  input.placeholder = t('placeholder');
  byId('clear-input').setAttribute('aria-label', t('clear'));
  renderCard();
  renderValidation();
  renderControls();
  publicStats?.renderStats(locale);
}

function clearCopyFeedback() {
  ++copySequence;
  clearTimeout(feedbackTimeout);
  copyFade?.cancel();
  copyFade = undefined;
  for (const button of copyButtons) {
    button.querySelector('.copy-feedback').hidden = true;
    button.classList.remove('is-copied', 'copy-error');
  }
  byId('live-feedback').textContent = '';
}

async function copyField(button) {
  clearCopyFeedback();
  const sequence = copySequence;
  const value = button.querySelector('[data-value]').textContent;
  let message = 'copied';
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    message = 'copyFailed';
  }
  if (sequence !== copySequence) return;
  const feedback = button.querySelector('.copy-feedback');
  feedback.textContent = t(message);
  feedback.hidden = false;
  button.classList.add(message === 'copied' ? 'is-copied' : 'copy-error');
  if (message === 'copied' && motionAllowed.matches) {
    copyFade = feedback.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: 'ease-out' });
  }
  byId('live-feedback').textContent = t(message);
  feedbackTimeout = setTimeout(clearCopyFeedback, 1800);
}

function selectMode(next) {
  const switching = next !== mode;
  // Read the displayed height before cancelling so a quick reversal starts where it is.
  const fromHeight = switching && motionAllowed.matches ? toolCard.getBoundingClientRect().height : 0;
  if (switching) cardResize?.cancel();
  clearCopyFeedback();
  mode = next;
  document.body.dataset.mode = mode;
  if (switching) byId(`${mode}-status`).append(byId('core-status'));
  for (const name of modes) {
    const selected = mode === name;
    const tab = byId(`tab-${name}`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(`panel-${name}`).hidden = !selected;
  }
  renderControls();
  if (fromHeight) {
    const toHeight = toolCard.getBoundingClientRect().height;
    if (toHeight && toHeight !== fromHeight) {
      const endHeight = CSS.supports('interpolate-size', 'allow-keywords') ? 'auto' : `${toHeight}px`;
      // CSS shortens an interrupted slide. Use its actual duration for the card too.
      const slide = tabList.getAnimations?.({ subtree: true }).find(animation =>
        animation.transitionProperty === 'transform' || animation.transitionProperty === 'clip-path');
      const glass = getComputedStyle(tabList, '::before');
      const duration = slide?.effect.getTiming().duration ?? parseFloat(glass.transitionDuration) * 1000;
      cardResize = toolCard.animate?.([{ height: `${fromHeight}px` }, { height: endHeight }],
        { duration, easing: glass.transitionTimingFunction });
    }
  }
}

motionAllowed.addEventListener('change', () => {
  if (!motionAllowed.matches) cardResize?.cancel();
});

async function nextCard() {
  if (busy) return;
  busy = true;
  issue = null;
  clearCopyFeedback();
  renderControls();
  try {
    if (!coreReady) {
      if (!core) {
        const url = new URL('./public/core/api.js', import.meta.url);
        // A browser can cache a failed module request for the lifetime of the page.
        if (moduleAttempts) url.searchParams.set('retry', String(moduleAttempts));
        moduleAttempts++;
        core = await import(url.href);
      }
      await core.loadCore();
      coreReady = true;
    }
    card = await core.generateCard(referenceDate());
    renderCard();
    analytics.then(module => module?.recordGeneration());
    if (mode === 'generate') byId('live-feedback').textContent = t('generated');
    return true;
  } catch {
    issue = coreReady ? 'generateError' : 'loadError';
  } finally {
    busy = false;
    renderControls();
  }
}

function clearValidation() {
  ++validationSequence;
  validation = null;
  byId('live-feedback').textContent = '';
  renderValidation();
  renderControls();
}

async function checkNumber(event) {
  event.preventDefault();
  if (!coreReady) return;
  const sequence = ++validationSequence;
  const raw = input.value;
  let result;
  try {
    result = raw.trim() ? await core.validateNumber(raw) : {status: 'empty'};
  } catch {
    result = {status: 'checkError'};
  }
  if (sequence !== validationSequence) return;
  validation = result;
  renderValidation();
  if (mode === 'validate') {
    const detail = byId('result-detail').textContent;
    byId('live-feedback').textContent = [t(result.status), detail].filter(Boolean).join(' · ');
  }
}

function enableGlassShine(button) {
  function reset() {
    button.style.removeProperty('--shine-x');
    button.style.removeProperty('--shine-y');
  }

  function track(event) {
    if (!event.isPrimary || !motionAllowed.matches) return;
    button.style.setProperty('--shine-x', `${event.offsetX}px`);
    button.style.setProperty('--shine-y', `${event.offsetY}px`);
  }

  for (const event of ['pointerenter', 'pointermove', 'pointerdown']) {
    button.addEventListener(event, track);
  }
  button.addEventListener('pointerleave', reset);
  button.addEventListener('pointercancel', reset);
  button.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse') reset();
  });
  motionAllowed.addEventListener('change', reset);
}

for (const button of document.querySelectorAll('.glass-button, .number-card, .tab')) {
  enableGlassShine(button);
}
function syncLocaleWithUrl() {
  const path = location.pathname.replace(/\/index\.html$/, '/');
  const next = path === localePages['zh-HK'].pathname ? 'zh-HK' : 'en';
  if (locale === next) return;
  clearCopyFeedback();
  locale = next;
  renderLocale();
}

localeSwitch.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  // Native link navigation still works if the browser restricts same-document history.
  try { history.pushState(null, '', localeSwitch.href); } catch { return; }
  event.preventDefault();
  syncLocaleWithUrl();
});
window.addEventListener('popstate', syncLocaleWithUrl);
for (const name of modes) {
  const tab = byId(`tab-${name}`);
  const refractedFace = tab.querySelector('.tab-face').cloneNode(true);
  refractedFace.classList.add('tab-refraction');
  refractedFace.setAttribute('aria-hidden', 'true');
  tab.append(refractedFace);
  tab.addEventListener('click', () => selectMode(name));
  tab.addEventListener('keydown', event => {
    let next;
    switch (event.key) {
      case 'Home': next = 'generate'; break;
      case 'End': next = 'validate'; break;
      case 'ArrowRight':
      case 'ArrowLeft': next = name === 'generate' ? 'validate' : 'generate'; break;
      default: return;
    }
    event.preventDefault();
    selectMode(next);
    byId(`tab-${next}`).focus();
  });
}
for (const button of copyButtons) button.addEventListener('click', () => copyField(button));
regenerateButton.addEventListener('click', async () => {
  if (await nextCard() && motionAllowed.matches) {
    refreshAngle += 360;
    regenerateButton.style.setProperty('--refresh-angle', `${refreshAngle}deg`);
  }
});
byId('retry-core').addEventListener('click', nextCard);
byId('validation-form').addEventListener('submit', checkNumber);
input.addEventListener('input', clearValidation);
byId('clear-input').addEventListener('click', () => {
  input.value = '';
  clearValidation();
  input.focus();
});

renderLocale();
import('./stats.js').then(module => {
  publicStats = module;
  module.renderStats(locale);
  return module.loadStats();
}).catch(() => {});
selectMode(mode);
nextCard();
