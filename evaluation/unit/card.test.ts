// Unit tests for the card field helpers. No framework - Node 22 runs
// TypeScript directly and has a built-in test runner:
//   node --test evaluation/unit
//
// These are the bits that are easy to get subtly wrong and hard to notice
// by clicking around: the masked display has to hide the middle digits
// while the real value stays intact underneath as the user types and
// backspaces.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  BULLET,
  isAmex,
  cardMaxLen,
  cvcLen,
  maskCardDisplay,
  unmaskCard,
  formatExpiry,
} from '../../lib/card.ts';

const VISA = '4242424242424242';   // 16 digits
const AMEX = '371449635398431';    // 15 digits

test('card type is detected from the first two digits', () => {
  assert.strictEqual(isAmex(AMEX), true);
  assert.strictEqual(isAmex('378282246310005'), true);   // 37 prefix
  assert.strictEqual(isAmex(VISA), false);
  assert.strictEqual(isAmex(''), false);
});

test('card length and security code length follow the card type', () => {
  assert.strictEqual(cardMaxLen(AMEX), 15);
  assert.strictEqual(cardMaxLen(VISA), 16);
  assert.strictEqual(cvcLen(AMEX), 4);
  assert.strictEqual(cvcLen(VISA), 3);
});

test('the middle eight digits are masked, grouped in fours', () => {
  assert.strictEqual(maskCardDisplay(VISA), `4242 ${BULLET.repeat(4)} ${BULLET.repeat(4)} 4242`);
  assert.strictEqual(maskCardDisplay(AMEX), `3714 ${BULLET.repeat(4)} ${BULLET.repeat(4)} 431`);
});

test('a partly typed number masks from the fifth digit onwards', () => {
  assert.strictEqual(maskCardDisplay('4242'), '4242');
  assert.strictEqual(maskCardDisplay('42424'), `4242 ${BULLET}`);
  assert.strictEqual(maskCardDisplay(''), '');
});

test('typing a full number one digit at a time keeps the real value intact', () => {
  let real = '';
  for (const ch of VISA) {
    real = unmaskCard(maskCardDisplay(real) + ch, real);
  }
  assert.strictEqual(real, VISA);
});

test('typing an Amex number keeps the real value intact and stops at 15', () => {
  let real = '';
  for (const ch of AMEX + '999') {   // try to overtype past the limit
    real = unmaskCard(maskCardDisplay(real) + ch, real);
  }
  assert.strictEqual(real, AMEX);
});

test('backspacing removes exactly one digit at a time', () => {
  let real = VISA;
  for (let i = 0; i < 3; i++) {
    const shown = maskCardDisplay(real).replace(/ /g, '').slice(0, -1);
    real = unmaskCard(shown, real);
  }
  assert.strictEqual(real, '4242424242424');
});

test('non-digits are ignored', () => {
  assert.strictEqual(unmaskCard('4242-abc-4242', ''), '42424242');
});

test('expiry is formatted as MM/YY while typing', () => {
  assert.strictEqual(formatExpiry('1'), '1');
  assert.strictEqual(formatExpiry('12'), '12');
  assert.strictEqual(formatExpiry('123'), '12/3');
  assert.strictEqual(formatExpiry('1228'), '12/28');
  assert.strictEqual(formatExpiry('12/28'), '12/28');
  assert.strictEqual(formatExpiry('122899'), '12/28');   // extra digits dropped
});
