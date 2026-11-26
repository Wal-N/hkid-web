import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, mock, test } from 'node:test';
import { loadCore, generateCard, validateNumber } from '../public/core/api.js';

// Unmodified conformance/hkid-number.json from the hkid-utils 1.2.0 release.
const vectors = JSON.parse(await readFile(new URL('./fixtures/hkid-number.json', import.meta.url), 'utf8'));

before(async () => {
  const wasm = new URL('../public/core/hkid_web_core_bg.wasm', import.meta.url);
  const fetchFile = mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), wasm.href);
    return new Response(await readFile(wasm), { headers: { 'Content-Type': 'application/wasm' } });
  });
  try {
    await loadCore();
  } finally {
    fetchFile.mock.restore();
  }
});

test('bundled WASM returns strict validation results for all upstream number cases', () => {
  for (const { id, input, expect } of vectors.parseCases) {
    // Upstream's permissive parse cases also include inputs missing their check digit.
    const expected = id.endsWith('without-check-digit')
      ? { status: 'missing', digit: expect.checkDigit }
      : { status: 'valid', number: expect.complete };
    assert.deepEqual(validateNumber(input), expected, id);
  }
  const errors = { INVALID_FORMAT: 'invalid', INVALID_CHECK_DIGIT: 'incorrect' };
  for (const { id, input, expectError } of vectors.invalidParseCases) {
    assert.deepEqual(validateNumber(input), { status: errors[expectError] }, id);
  }
});

test('generated samples contain printable card fields and a summary in both languages', () => {
  for (let i = 0; i < 50; i++) {
    const card = generateCard('2026-11-25');
    assert.deepEqual(validateNumber(card.number), { status: 'valid', number: card.number });
    assert.match(card.chineseName, /\p{Script=Han}/u);
    assert.match(card.englishName, /.+, .+/);
    assert.match(card.commercialCodes, /^\d{4}( \d{4})*$/);
    assert.match(card.sex, /^(男 M|女 F)$/);
    assert.match(card.birthDate, /^\d{2}-\d{2}-\d{4}$/);
    assert.match(card.firstRegistration, /^\d{2}-\d{2}$/);
    assert.match(card.registrationDate, /^\d{2}-\d{2}-\d{2}$/);
    assert.ok(card.symbols.length > 0);
    assert.match(card.summaries.en, /holder/i);
    assert.match(card.summaries['zh-HK'], /持有人/);
  }
});
