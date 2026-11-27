# HKID Web product specification

HKID Web generates one sample Hong Kong identity card at a time and checks the format and check digit of an HKID number. Both tools run in the browser and are available in English and Hong Kong Traditional Chinese. This document defines their behaviour and release criteria. The [README](README.md) shows visitors how to use the published site.

## Generate

**Generate** is the first tab on each fresh page load. Once the WebAssembly (WASM) core is ready, it generates a complete sample using the current Hong Kong calendar date. The HKID number appears first, followed by the Chinese name, English name, date of birth, sex, Chinese commercial codes, card symbols, first registration and date of registration. A full-width holder summary appears below the fields. The notice explains that samples are for testing only and that generated details may match those on a real Hong Kong identity card. **Regenerate** sits below the notice and produces a new sample.

| English label | Traditional Chinese label | Printed format | Example copied value |
| --- | --- | --- | --- |
| Date of birth | 出生日期 | `dd-mm-yyyy` | `15-01-1990` |
| First registration | 首次登記年月 | `mm-yy` | `06-01` |
| Date of registration | 登記日期 | `dd-mm-yy` | `01-06-20` |

Each value is a button. Clicking, tapping or pressing Enter or Space on a focused value copies its displayed text. The two names copy separately, the commercial codes copy as one space-separated group, and sex retains the printed form `男 M` or `女 F` in either language. The summary button copies the full paragraph in the active language. The selected field briefly shows “Copied” or “Copy failed” in that language and announces the outcome to screen readers.

## Validate

**Check** or Enter submits the current field value. Blank or whitespace-only input prompts the user to enter a number. For other input, the Rust adapter calls `HkidNumber::parse_with_check_digit`. Only a missing check digit triggers a second parse to calculate the digit. A successful check establishes format and checksum consistency. Issuance and the holder’s identity are outside the scope of the check.

| Input | English result | Hong Kong Traditional Chinese result |
| --- | --- | --- |
| `Ａ 123456 （３）` | Valid format and check digit · `A123456(3)` | 格式及校驗碼相符 · `A123456(3)` |
| `A123456` | Check digit missing · Calculated digit `3` | 欠校驗碼 · 計算值 `3` |
| `A123456(4)` | Incorrect check digit | 校驗碼不符 |
| `A12X456(3)` | Invalid number format | 號碼格式錯誤 |

Editing the input immediately dismisses its previous result. Clearing the field also returns focus to it. Switching tabs preserves the current sample, validation input and result. [Validation and generation adapter](core/src/lib.rs)

## Languages, navigation and accessibility

- English opens at `/hkid-web/` and Traditional Chinese at `/hkid-web/zh-hk/`. Both are static HTML entry pages with localised titles and descriptions, self-referencing canonical URLs and reciprocal `hreflang` links. The English entry is the `x-default`. Generated values carry `data-nosnippet`.
- The language link reads **繁中** on the English page and **English** on the Chinese page. Switching in the same document updates the URL and keeps the active tab, sample, input and validation result. Back and Forward follow the language history. Each sample carries both original library summaries for the same card and reference date.
- Generate uses blue and Validate uses green. A vertical gradient behind the toolbar and tool card fades to the page’s light background before the footer. Usage statistics and privacy information appear as plain text and links below the card. The loading layout reserves space for the sample. Narrow layouts allow date labels to wrap and the fields to reflow as text grows.
- The tabs support Left, Right, Home and End. Focus is visible, status changes are announced, and validation uses text and icons alongside colour. The interface respects reduced-motion and forced-colour preferences. The design target for normal text contrast is 4.5:1. A failed core download offers a localised **Retry** action. The language link and footer privacy disclosure also work with JavaScript disabled. [English entry](index.html) · [Chinese entry](zh-hk/index.html) · [Interface styles](styles.css)

## Architecture and privacy

The frontend uses static HTML, CSS and native JavaScript modules. The Node.js build copies an explicit list of public files into `dist/` and writes the public analytics configuration. The site ships the prebuilt WASM binary, its JavaScript bindings and the third-party licence notices. [Build script](scripts/build-site.mjs) · [Public file list](scripts/site-files.mjs)

The Rust adapter pins `hkid-utils` 1.2.1 and exposes generation and validation through `wasm-bindgen`. Each generation uses a fresh 64-bit seed from Web Crypto and passes the Hong Kong date to `card_on`. The library supplies the number rules, names, printable fields and both versions of the holder summary. The UI displays the library’s wording directly. [Core dependencies](core/Cargo.toml) · [Browser adapter](public/core/api.js) · [Core build and licences](core/README.md)

Entered numbers, generated card details and results stay in page memory. The app excludes them from URLs, browser storage and analytics events. Clipboard access occurs when the user activates a copy button. Both language pages explain the optional analytics collection in their footer.

## Usage statistics and publication

With collection enabled on the production Pages site, the app sends one `page_view` when a document loads. It sends one `hkid_generated` for each successful sample, including the automatic first sample. Opening the page and choosing **Regenerate** twice gives one page view and three generation events if all three samples succeed. Switching languages within the document preserves the page-view count. Both languages contribute to the same totals. Local previews and browsers that set `navigator.webdriver` skip collection. The tools remain usable when collection is disabled or blocked. [Analytics implementation](analytics.js)

Both HTML pages start their head with the same analytics module. On production pages with collection enabled, it loads Google Tag Manager container `GTM-MTSLZZ7V` once and sends the two events to its linked GA4 stream, `G-PE5SLFMXFY`. The module supplies the canonical project URL and a fixed page title for both languages. Before enabling collection, configure the stream for manual page views and turn off enhanced measurement and user-provided data collection. The build and reporting workflow accept only the linked measurement ID after trimming whitespace. A missing or mismatched ID keeps collection off. [Stream configuration](analytics-config.json) · [Visitor privacy and statistics](README.md#privacy-and-usage-statistics)

The footer reads the estimated visitor count, recorded generation count and reporting date from `stats.json`. It shows “Statistics pending” until the first report is published. Hovering over the reporting date shows a short notice about the delay. At 17 minutes past each hour, the workflow asks GA4 for totals from the first day of tracking through the current Hong Kong date. It can also run on demand. Recent totals may change as GA4 processes events. A new reporting date or a change in either total triggers publication from `main`. A failed report leaves the last published totals available. [Hourly reporting workflow](.github/workflows/daily-stats.yml)

The publication target is `https://wal-n.github.io/hkid-web/`. Pull requests targeting `main` and pushes to `main` run unit and integration tests, build the static site and exercise that build in Chromium, Firefox and WebKit. An eligible `main` run restores the last available statistics before browser testing and deploys the tested artifact once it verifies that the revision still heads `main`. The first release can publish with analytics disabled and statistics pending. [Pages workflow](.github/workflows/pages.yml)

## Acceptance checks

- Run the bundled WASM against the upstream number fixtures, including single and double prefixes, leading zeroes, full-width input, check digit A, missing digits and incorrect digits. Generated numbers must pass strict validation, with printable card fields and a holder summary in each language. [Core tests](tests/core.test.mjs)
- Exercise both language URLs under the Pages project path. Verify generation and validation, clearing stale results, state across language changes and browser history, and recovery after a failed WASM request. A clipboard test double checks the exact text copied by each of the ten buttons. [Browser tests](scripts/test-browser.mjs)
- In Chromium, check initial layout shift at 390px and 1280px with a delayed WASM response (maximum 0.1). At 320px with a 200% default font, all three date formats must remain readable. The privacy disclosure must open with JavaScript disabled. Across all three browsers, it expands and collapses smoothly, reverses when toggled mid-animation and switches immediately with reduced motion enabled. [Layout checks](scripts/test-browser-layout.mjs)
- In 900 × 1600 and 1440 × 2560 portrait viewports, footer text must reach at least 4.5:1 contrast against its background in both Generate and Validate, in English and Traditional Chinese. [Footer contrast checks](scripts/test-browser-layout.mjs)
- For a production release, verify the real clipboard on mobile Safari and exercise generation and validation from the published Pages URL. If analytics is enabled, confirm that the expected events reach the configured GA4 property.

## Next Phase

**Check card details** is a proposal. A user could enter any available combination of HKID number, date of birth, registration date and card symbols. Results would distinguish a field error, a cross-field inconsistency and a check that needs more information. For example, registration before birth would be a date inconsistency. A prefix that differs from the library’s reference data would warrant an advisory. The feature’s scope and UI remain open. Candidate library APIs include `HkidCard` construction, `validate_as_of` and `find_suspicions`. [Upstream card API](https://github.com/Wal-N/hkid/blob/v1.2.1/rust/README.md#complete-and-partial-cards)
