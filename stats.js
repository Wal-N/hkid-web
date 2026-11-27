let snapshot = null;

export function parseStats(data) {
  if (!data) return null;
  const { visitors, generated, through } = data;
  if (![visitors, generated].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  if (typeof through !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(through)) return null;
  const date = new Date(through + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== through) return null;
  return { visitors, generated, through };
}

export function renderStats(locale) {
  const english = locale === 'en';
  const visitorsLabel = document.getElementById('stats-visitors');
  const generatedLabel = document.getElementById('stats-generated');
  const number = new Intl.NumberFormat(locale);
  const visitors = snapshot ? number.format(snapshot.visitors) : '—';
  const generated = snapshot ? number.format(snapshot.generated) : '—';
  visitorsLabel.textContent = english ? `Visitors: ${visitors}` : `累計訪客 ${visitors} 人`;
  generatedLabel.textContent = english ? `HKIDs generated: ${generated}` : `已生成 ${generated} 筆 HKID`;

  if (!snapshot) return;
  const delayNotice = english
    ? 'Google Analytics takes time to process data, so these totals may not yet include recent activity.'
    : 'Google Analytics 處理數據需時，最近的統計數據可能尚未計入。';
  visitorsLabel.title = delayNotice;
  generatedLabel.title = delayNotice;
}

export async function loadStats() {
  try {
    const response = await fetch(new URL('./stats.json', import.meta.url), {
      mode: 'same-origin', credentials: 'omit', cache: 'no-cache',
    });
    if (!response.ok) return;
    const fresh = parseStats(await response.json());
    if (!fresh) return;
    snapshot = fresh;
    renderStats(document.documentElement.lang);
  } catch {
    // The last published totals can be unavailable while the rest of the site works offline.
  }
}
