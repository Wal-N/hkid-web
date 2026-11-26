# hkid-web

This bilingual web tool uses [**HKID Utilities (`hkid-utils`)**](https://github.com/Wal-N/hkid) to generate Hong Kong identity card test records and validate the format and check digit of HKID numbers. The Rust library (version 1.2.0) runs in the browser through WebAssembly and provides holder summaries in English and Traditional Chinese.

A generated sample may match an issued number. [Product specification](PLAN.md)

[Open the English tool](https://wal-n.github.io/hkid-web/) · [開啟繁體中文版](https://wal-n.github.io/hkid-web/zh-hk/)

## Local preview

From the project directory, start the preview with Node.js and npm.

```sh
npm start
```

Open the [English preview](http://127.0.0.1:4173/hkid-web/) or [繁體中文預覽](http://127.0.0.1:4173/hkid-web/zh-hk/). Press Ctrl+C in the terminal to stop it. To choose another port, use `npm start -- 4174`.

The preview serves static files on the loopback interface. Generation, validation and holder summaries run in the browser. Switching languages updates the URL and keeps the current sample and validation input in page memory.

The browser bundle is included. See the [core build instructions](core/README.md) to rebuild it from Rust.

## Test and publish

For the full test suite, use Node.js 22 with npm to match CI, and make sure `git` is on your `PATH`. The statistics integration test creates a temporary local Git repository. The browser tests serve the built `dist/` directory at the same path as the GitHub Pages project and exercise Chromium, Firefox and WebKit.

```sh
npm ci
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium firefox webkit` to install the system libraries as well. To test a different build directory, run `npm run test:browser -- <directory>`.

Select **GitHub Actions** as the repository’s Pages source. **Test and publish site** checks pull requests and publishes the tested artifact on pushes to `main`. You can also run it manually from `main`. The site can launch with statistics pending and analytics disabled. [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

After deployment, generate and validate a sample at the public URL, verify copying and pasting on mobile Safari, and confirm event receipt in GA4 if collection is enabled. [Release acceptance checks](PLAN.md#acceptance-checks)

## Public usage statistics

The footer reads two totals and their cutoff date from `stats.json`. Until a report is available, it shows “Statistics pending”. When production analytics is enabled, the site sends one `page_view` per page load and one `hkid_generated` per successful sample, including the automatic first sample. Opening the page and choosing **Regenerate** twice gives one page view and three generation events if all three samples succeed. Local previews skip collection. HKID values, form inputs and holder details stay in the browser.

The daily workflow counts distinct visitors over the whole reporting period and successful generation events recorded by GA4. Each refresh includes the current Hong Kong date. GA4 processes events throughout the day, so recent totals can change on a later refresh. Visitor counts are estimates, and visits with collection blocked or offline can go unrecorded. [GA4 reporting freshness](https://support.google.com/analytics/answer/11198161)

### Enable optional analytics

1. Both pages use Google Tag Manager container `GTM-MTSLZZ7V`, linked to GA4 web stream `G-PE5SLFMXFY`. In the stream's settings, turn off **Enhanced measurement**. In the Google tag settings, turn off automatic detection of form interactions and browser history changes, and turn off **Allow user-provided data capabilities**. The site supplies its own page view and generation events. Use Hong Kong as the property's reporting time zone. [Google tag settings](https://support.google.com/analytics/answer/12131703) · [Enhanced measurement](https://support.google.com/analytics/answer/9216061)
2. Enable the **Google Analytics Data API** and **IAM Service Account Credentials API** in your Google Cloud project and grant a service account **Viewer** access to the GA4 property. Configure GitHub OIDC through Workload Identity Federation for that service account. Restrict the trust to this repository and its default branch. The workflow uses a short-lived read-only token. [Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart) · [Google's GitHub authentication setup](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account)
3. In the repository's **Settings → Secrets and variables → Actions → Variables**, set these repository variables.

   | Variable | Value |
   | --- | --- |
   | `GA4_MEASUREMENT_ID` | Set to `G-PE5SLFMXFY` to enable the linked stream after configuring its collection settings. An empty value keeps the tag off. |
   | `GA4_PROPERTY_ID` | Numeric GA4 property ID |
   | `GA4_START_DATE` | First day of site tracking in Hong Kong, `YYYY-MM-DD` |
   | `GA4_WIF_PROVIDER` | Full Workload Identity provider name, `projects/…/locations/global/workloadIdentityPools/…/providers/…` |
   | `GA4_SERVICE_ACCOUNT` | Email of the read-only service account |

4. Run **Test and publish site** from `main` to activate the tag. In a regular browser, open the public page and select **Regenerate** once. In the stream's GA4 Realtime report, check for one new `page_view` and two new `hkid_generated` events, allowing for other live traffic. [GA4 Realtime report](https://support.google.com/analytics/answer/9271392)
5. **Update daily usage statistics** requests a report each day at **10:17 Hong Kong time** and can also run manually. The first successful report creates the `usage-stats` branch. A new reporting date or revised same-day totals update that branch’s `stats.json` and start **Test and publish site** on the latest `main`. Site releases reuse the saved totals if a later report fails. On public repositories, GitHub pauses scheduled workflows after 60 days without repository activity. [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
