# HKID Web

Generate sample Hong Kong identity card (HKID) details and check HKID numbers in your browser. Both tools use [**HKID Utilities (`hkid-utils`)**](https://github.com/Wal-N/hkid).

[Open in English](https://wal-n.github.io/hkid-web/) · [開啟繁體中文版](https://wal-n.github.io/hkid-web/zh-hk/)

## Generate a sample

The **Generate** tab opens with a sample HKID number, Chinese and English names, and card details. Select any value to copy it, or select **Regenerate** for another sample. This sample is for testing only. The generated details may match those on someone’s real Hong Kong identity card.

## Check a number

Open **Validate**, enter an HKID number and select **Check**. A successful check confirms the number’s format and check digit. To calculate a missing digit, enter just the prefix and six digits. For example, `A123456` gives the check digit `3`.

## Privacy and usage statistics

The site checks HKID numbers and generates samples in your browser. It does not upload the numbers you enter, your validation results or any generated sample details, including HKID numbers, names and dates of birth.

Google Analytics 4 (GA4) records a page view (`page_view`) when the page loads and a generation event (`hkid_generated`) each time a sample is created, including the automatic first sample. GA4 also receives browser information such as language and screen resolution. It may use cookies to estimate how many people visit. [How Google Analytics collects data](https://support.google.com/analytics/answer/11593727?hl=en)

The footer shows the estimated number of visitors and how many samples GA4 has counted. The site checks for updated totals every hour. Recent visits and generations may take longer to appear while GA4 processes them.
