// Unit tests for the client-side password rule. This mirrors the server-side
// check in auth.js, so if the two ever drift apart the UI would accept
// something the API rejects. These tests pin the client half.

import { test } from 'node:test';
import assert from 'node:assert';
import { validatePasswordClient } from '../../lib/validation.ts';

test('a password meeting every rule is accepted', () => {
  assert.strictEqual(validatePasswordClient('TestPass123!'), null);
});

test('length is bounded at both ends', () => {
  assert.match(validatePasswordClient('Short1!') ?? '', /12-24 characters/);
  assert.match(validatePasswordClient('WayTooLongPassword123!!!!') ?? '', /12-24 characters/);
  assert.strictEqual(validatePasswordClient('Exactly12Ch!'), null);          // 12
  assert.strictEqual(validatePasswordClient('TwentyFourCharsLong123!!'), null); // 24
});

test('each character class is required', () => {
  assert.match(validatePasswordClient('alllowercase1!') ?? '', /uppercase/);
  assert.match(validatePasswordClient('ALLUPPERCASE1!') ?? '', /lowercase/);
  assert.match(validatePasswordClient('NoDigitsHere!!') ?? '', /number/);
  assert.match(validatePasswordClient('NoSpecialChar123') ?? '', /special character/);
});
