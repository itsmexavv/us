import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemble, captionForBookFolder } from '../lib/assemble.mjs';

const book = {
  yourName: 'Sam',
  herName: 'Alex',
  startDate: '2025-12-05',
  reasons: ['your laugh', 'your kindness', ''],
  months: [{ title: 'First dates' }, { title: '[Month 2 title]' }],
  letter: { greeting: 'My dearest Alex,', page1: ['one'], page2: ['two'], signoff: 'Yours,', signature: 'Sam' },
  closingLine: '[One last line]'
};

test('takes names, date and reasons from the book', () => {
  const out = assemble(book, {});
  assert.equal(out.herName, 'Alex');
  assert.equal(out.yourName, 'Sam');
  assert.equal(out.startDate, '2025-12-05');
  assert.deepEqual(out.reasons, ['your laugh', 'your kindness']);
});

test('extra reasons come after the book\'s, without repeats', () => {
  const out = assemble(book, { extraReasons: ['your laugh', 'the way you hum'] });
  assert.deepEqual(out.reasons, ['your laugh', 'your kindness', 'the way you hum']);
});

test('with no card note, the book letter is used', () => {
  const out = assemble(book, { note: null });
  assert.deepEqual(out.note, { greeting: 'My dearest Alex,', paragraphs: ['one', 'two'], signoff: 'Yours,', signature: 'Sam' });
});

test('a card note gets a default greeting and signature', () => {
  const out = assemble(book, { note: { greeting: null, paragraphs: ['hi'], signoff: 'x', signature: null } });
  assert.equal(out.note.greeting, 'Hi Alex,');
  assert.equal(out.note.signature, 'Sam');
});

test('tap.js can override the book', () => {
  const out = assemble(book, { herName: 'Lex', startDate: '2025-12-06' });
  assert.equal(out.herName, 'Lex');
  assert.equal(out.startDate, '2025-12-06');
});

test('the song shows only with an https link', () => {
  assert.equal(assemble(book, { song: { label: 'x', url: '' } }).song, null);
  assert.equal(assemble(book, { song: { label: 'x', url: 'javascript:alert(1)' } }).song, null);
  assert.deepEqual(assemble(book, { song: { label: 'x', url: 'https://open.spotify.com/track/1' } }).song,
    { label: 'x', url: 'https://open.spotify.com/track/1' });
});

test('special dates must be MM-DD with a message', () => {
  const out = assemble(book, { specialDates: { '02-14': ' hi ', 'bad': 'x', '03-01': '' } });
  assert.deepEqual(out.specialDates, { '02-14': 'hi' });
});

test('a missing or malformed start date stops the build', () => {
  assert.throws(() => assemble({}, {}), /YYYY-MM-DD/);
  assert.throws(() => assemble({ startDate: '5/12/2025' }, {}), /YYYY-MM-DD/);
});

test('a placeholder closing line is left out', () => {
  assert.equal(assemble(book, {}).closingLine, '');
});

test('book month folders are captioned with the month title once it is written', () => {
  assert.equal(captionForBookFolder('02-month-01', book), 'First dates');
  assert.equal(captionForBookFolder('03-month-02', book), '');
  assert.equal(captionForBookFolder('01-cover', book), '');
});

test('the committed template loads and assembles', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../content-template/tap.js', import.meta.url), 'utf8'), sandbox);
  const out = assemble(book, sandbox.window.TAP);
  assert.equal(out.note.greeting, 'Hi Alex,');
  assert.equal(out.song, null);
  assert.ok(out.reasons.length >= 3);
});
