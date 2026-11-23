import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlEncode, b64urlDecode, isValidKeyString, keyFromHash, newKeyString,
  encryptJSON, decryptJSON, daysSince, togetherParts, pickOfTheDay, specialsFor, daysUntil,
  ndefMessageBytes, NTAG213_NDEF_BYTES, findPlaceholders, KEY_CHARS
} from '../docs/core.js';

const local = (y, m, d, hh = 12, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss);

test('base64url round-trips every byte value', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const s = b64urlEncode(bytes);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(b64urlDecode(s), bytes);
});

test('new keys are 43 url-safe characters and differ each time', () => {
  const a = newKeyString(), b = newKeyString();
  assert.equal(a.length, KEY_CHARS);
  assert.ok(isValidKeyString(a));
  assert.notEqual(a, b);
});

test('keyFromHash reads #k= and rejects junk', () => {
  const k = newKeyString();
  assert.equal(keyFromHash(`#k=${k}`), k);
  assert.equal(keyFromHash(`#x=1&k=${k}`), k);
  assert.equal(keyFromHash('#k=short'), null);
  assert.equal(keyFromHash(''), null);
  assert.equal(keyFromHash(undefined), null);
});

test('encrypt then decrypt gives back the same content', async () => {
  const k = newKeyString();
  const obj = { herName: 'Test ♡', reasons: ['a', 'b'], photos: [{ src: 'data:image/jpeg;base64,AAAA' }] };
  const bytes = await encryptJSON(k, obj);
  assert.deepEqual(await decryptJSON(k, bytes), obj);
});

test('the same content encrypts differently each time (fresh IV)', async () => {
  const k = newKeyString();
  const a = await encryptJSON(k, { x: 1 }), b = await encryptJSON(k, { x: 1 });
  assert.notDeepEqual(a, b);
});

test('a wrong key fails', async () => {
  const bytes = await encryptJSON(newKeyString(), { secret: true });
  await assert.rejects(decryptJSON(newKeyString(), bytes));
});

test('changed bytes fail', async () => {
  const k = newKeyString();
  const bytes = await encryptJSON(k, { secret: true });
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptJSON(k, bytes));
});

test('a truncated payload fails', async () => {
  await assert.rejects(decryptJSON(newKeyString(), new Uint8Array(10)));
});

test('the plain text does not appear in the encrypted bytes', async () => {
  const bytes = await encryptJSON(newKeyString(), { herName: 'Wilhelmina' });
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('Wilhelmina'));
});

test('daysSince counts calendar days', () => {
  assert.equal(daysSince('2025-12-05', local(2025, 12, 5, 0, 1)), 0);
  assert.equal(daysSince('2025-12-05', local(2025, 12, 5, 23, 59)), 0);
  assert.equal(daysSince('2025-12-05', local(2025, 12, 6, 0, 0)), 1);
  assert.equal(daysSince('2025-12-05', local(2026, 12, 5)), 365);
  assert.equal(daysSince('2025-12-05', local(2025, 12, 1)), -4);
});

test('daysSince is not shifted by daylight saving changes', () => {
  // Spans both the March and October/November changes in most zones that have them.
  for (let d = 0; d < 400; d++) {
    const when = new Date(2026, 0, 1 + d, 0, 30);
    assert.equal(daysSince('2026-01-01', when), d);
  }
});

test('togetherParts gives days plus the time of day', () => {
  assert.deepEqual(togetherParts('2025-12-05', local(2026, 11, 23, 6, 12, 9)),
    { days: 353, hours: 6, minutes: 12, seconds: 9 });
  assert.equal(togetherParts('2025-12-05', local(2025, 11, 1)).days, 0);
});

test('pickOfTheDay is steady within a day and covers every item once per cycle', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  const seen = new Set();
  for (let day = 100; day < 105; day++) seen.add(pickOfTheDay(list, day));
  assert.equal(seen.size, list.length);
  assert.equal(pickOfTheDay(list, 7), pickOfTheDay(list, 7));
  assert.equal(pickOfTheDay(list, -1), 'e');
  assert.equal(pickOfTheDay([], 3), null);
});

test('the anniversary is detected, and only then', () => {
  assert.deepEqual(specialsFor('2025-12-05', local(2026, 12, 5)), [{ kind: 'anniversary', years: 1 }]);
  assert.deepEqual(specialsFor('2025-12-05', local(2027, 12, 5)).map((s) => s.kind), ['anniversary']);
  assert.deepEqual(specialsFor('2025-12-05', local(2025, 12, 5)), []); // the day itself is not an anniversary
  assert.deepEqual(specialsFor('2025-12-05', local(2026, 12, 6)), []);
});

test('monthiversaries are detected and counted', () => {
  assert.deepEqual(specialsFor('2025-12-05', local(2026, 1, 5)), [{ kind: 'monthiversary', months: 1 }]);
  assert.deepEqual(specialsFor('2025-12-05', local(2026, 11, 5)), [{ kind: 'monthiversary', months: 11 }]);
  assert.deepEqual(specialsFor('2025-12-05', local(2025, 11, 5)), []); // before the start
});

test('a start on the 31st is celebrated on the last day of shorter months', () => {
  assert.deepEqual(specialsFor('2025-01-31', local(2025, 2, 28)), [{ kind: 'monthiversary', months: 1 }]);
  assert.deepEqual(specialsFor('2025-01-31', local(2025, 4, 30)), [{ kind: 'monthiversary', months: 3 }]);
  assert.deepEqual(specialsFor('2024-02-29', local(2025, 2, 28)), [{ kind: 'anniversary', years: 1 }]);
});

test('every 100th day is a milestone', () => {
  const day100 = new Date(2025, 11, 5 + 100, 12);
  assert.deepEqual(specialsFor('2025-12-05', day100), [{ kind: 'milestone', days: 100 }]);
});

test('custom dates show their message', () => {
  const sp = specialsFor('2025-12-05', local(2026, 2, 14), { '02-14': 'Happy Valentine\'s' });
  assert.deepEqual(sp, [{ kind: 'custom', message: 'Happy Valentine\'s' }]);
});

test('daysUntil counts down and disappears once passed', () => {
  assert.equal(daysUntil('2026-12-24', local(2026, 12, 20)), 4);
  assert.equal(daysUntil('2026-12-24', local(2026, 12, 24, 23)), 0);
  assert.equal(daysUntil('2026-12-24', local(2026, 12, 25)), null);
  assert.equal(daysUntil(null, local(2026, 1, 1)), null);
});

test('the card link fits an NTAG213', () => {
  const url = `https://itsmexavv.github.io/us/#k=${newKeyString()}`;
  const size = ndefMessageBytes(url);
  assert.equal(size, 4 + 1 + url.length - 'https://'.length);
  assert.ok(size <= NTAG213_NDEF_BYTES, `${size} bytes`);
});

test('findPlaceholders lists every [bracketed] string with its path', () => {
  const found = findPlaceholders({ a: 'fine', b: ['[todo]', 'ok'], c: { d: 'x [y] z' } });
  assert.deepEqual(found.map((f) => f.path), ['b[0]', 'c.d']);
});
