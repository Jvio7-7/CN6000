// Unit tests for the shared auth module the Lambda functions import. This is
// plain CommonJS, so it can be required straight from here.
//
// The parity test at the bottom is the important one. lib/validation.ts is a
// copy of the same password rule for instant UI feedback, and if the two ever
// drift the form would accept something the API then rejects.

import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { validatePasswordClient } from '../../lib/validation.ts';

const require = createRequire(import.meta.url);

process.env.JWT_SECRET = 'test-secret-for-unit-tests-only';
process.env.REPLICATION_SECRET = 'test-replication-secret';

const auth = require('../../lambda/layer/nodejs/auth.js');

test('password hashing is one-way and verifies against the original', async () => {
  const hash = await auth.hashPassword('TestPass123!');
  assert.notStrictEqual(hash, 'TestPass123!');
  assert.strictEqual(await auth.verifyPassword('TestPass123!', hash), true);
  assert.strictEqual(await auth.verifyPassword('WrongPass123!', hash), false);
});

test('the same password hashes differently each time', async () => {
  const a = await auth.hashPassword('TestPass123!');
  const b = await auth.hashPassword('TestPass123!');
  assert.notStrictEqual(a, b);   // salted
  assert.strictEqual(await auth.verifyPassword('TestPass123!', b), true);
});

test('a signed token round-trips back to the same user', () => {
  const user = { id: 'abc-123', email: 'someone@test.local', name: 'Someone' };
  const token = auth.signToken(user);
  const decoded = auth.verifyToken(`Bearer ${token}`);
  // the id is carried in the standard "sub" claim, not as "id"
  assert.strictEqual(decoded.sub, user.id);
  assert.strictEqual(decoded.email, user.email);
  assert.strictEqual(decoded.name, user.name);
});

test('bad tokens are rejected rather than throwing', () => {
  assert.strictEqual(auth.verifyToken('Bearer not-a-token'), null);
  assert.strictEqual(auth.verifyToken(''), null);
  assert.strictEqual(auth.verifyToken(undefined), null);
});

test('the replication key check accepts only the exact secret', () => {
  const withKey = (v) => ({ headers: { 'x-replication-key': v } });
  assert.strictEqual(auth.checkReplicationKey(withKey('test-replication-secret')), true);
  assert.strictEqual(auth.checkReplicationKey(withKey('wrong-secret')), false);
  assert.strictEqual(auth.checkReplicationKey(withKey('')), false);
  assert.strictEqual(auth.checkReplicationKey({ headers: {} }), false);
  assert.strictEqual(auth.checkReplicationKey({}), false);
});

test('a near-miss secret of the same length is still rejected', () => {
  // the comparison hashes both sides first, so length games do not help
  const almost = 'test-replication-secreT';
  assert.strictEqual(
    auth.checkReplicationKey({ headers: { 'x-replication-key': almost } }),
    false
  );
});

test('the client and server password rules agree', () => {
  const cases = [
    'TestPass123!',              // valid
    'Short1!',                   // too short
    'WayTooLongPassword123!!!!', // too long
    'alllowercase1!',            // no uppercase
    'ALLUPPERCASE1!',            // no lowercase
    'NoDigitsHere!!',            // no number
    'NoSpecialChar123',          // no symbol
    'Exactly12Ch!',              // lower bound
    'TwentyFourCharsLong123!!',  // upper bound
  ];
  for (const pw of cases) {
    const server = auth.validatePassword(pw);
    const client = validatePasswordClient(pw);
    assert.strictEqual(
      server,
      client,
      `client and server disagree on "${pw}": server=${server} client=${client}`
    );
  }
});
