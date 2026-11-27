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
  const pending = document.getElementById('stats-pending');
  pending.textContent = english ? 'Statistics pending' : '統計待更新';
  pending.hidden = snapshot !== null;
  if (!snapshot) {
    visitorsLabel.textContent = english ? 'Visitors —' : '累計訪客 —';
    generatedLabel.textContent = english ? 'HKIDs generated —' : '已生成 HKID —';
    return;
  }

  const number = new Intl.NumberFormat(locale);
  const visitors = number.format(snapshot.visitors);
  const generated = number.format(snapshot.generated);
  visitorsLabel.textContent = english
    ? `About ${visitors} ${snapshot.visitors === 1 ? 'visitor' : 'visitors'}`
    : `累計訪客約 ${visitors} 人`;
  generatedLabel.textContent = english
    ? `${generated} ${snapshot.generated === 1 ? 'HKID' : 'HKIDs'} generated`
    : `已生成 ${generated} 筆 HKID`;

  const delayNotice = english
    ? 'Google Analytics may still be processing recent visits and HKID generation events.'
    : 'Google Analytics 處理數據需時，最近的瀏覽和 HKID 生成次數可能尚未計入。';
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
