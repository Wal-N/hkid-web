const site = new URL('https://wal-n.github.io/hkid-web/');
const localeDirectories = [site.pathname, site.pathname + 'zh-hk/'];
const entryPaths = localeDirectories.flatMap(directory => [
  directory, directory + 'index.html', directory.slice(0, -1),
]);

async function startCollection() {
  if (location.origin !== site.origin || !entryPaths.includes(location.pathname) || navigator.webdriver) return;

  const response = await fetch(new URL('./analytics-config.json', import.meta.url), {
    mode: 'same-origin', credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) return;
  const { measurementId, destinationId, hostname, pagePath } = await response.json();
  // This container is linked to one GA4 stream. A different ID would send data elsewhere.
  if (hostname !== site.hostname || pagePath !== site.pathname ||
      typeof measurementId !== 'string' || !/^G-[A-Z0-9]+$/.test(measurementId) ||
      measurementId !== destinationId) return;
  const container = document.querySelector('script[data-google-tag-src]');
  if (!container) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  const settings = {
    send_page_view: false,
    page_location: site.href, // Both languages share the existing public totals.
    page_referrer: '',
    page_title: 'HKID',
    ignore_referrer: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
  // Apply these defaults to the container as well as its destination before either starts.
  gtag('set', settings);
  gtag('js', new Date());
  gtag('config', measurementId, settings);
  gtag('event', 'page_view', { send_to: measurementId });

  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = container.dataset.googleTagSrc;
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  return () => gtag('event', 'hkid_generated', { send_to: measurementId });
}

// Keep the first automatic generation and any clicks made while the tag is loading.
const collection = startCollection().catch(() => undefined);

export function recordGeneration() {
  collection.then(send => send?.()).catch(() => {});
}
