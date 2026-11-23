// Merges the book's words (anniversary-book/content.js) with the card-only extras (content/tap.js)
// into the text part of the payload. Pure: no files, no photos.

import { parseDate } from '../docs/core.js';

const isPlaceholder = (s) => typeof s === 'string' && /\[[^\]]+\]/.test(s);
const clean = (list) => (Array.isArray(list) ? list : [])
  .filter((s) => typeof s === 'string' && s.trim() !== '')
  .map((s) => s.trim());

export function assemble(book = {}, tap = {}) {
  const herName = tap.herName ?? book.herName ?? '';
  const yourName = tap.yourName ?? book.yourName ?? '';
  const startDate = tap.startDate ?? book.startDate;
  parseDate(startDate); // throws with a clear message if it's missing or malformed

  let note;
  if (tap.note) {
    note = {
      greeting: tap.note.greeting ?? `Hi ${herName},`,
      paragraphs: clean(tap.note.paragraphs),
      signoff: tap.note.signoff ?? '',
      signature: tap.note.signature ?? yourName
    };
  } else if (book.letter) {
    note = {
      greeting: book.letter.greeting ?? `Hi ${herName},`,
      paragraphs: [...clean(book.letter.page1), ...clean(book.letter.page2)],
      signoff: book.letter.signoff ?? '',
      signature: book.letter.signature ?? yourName
    };
  } else {
    note = null;
  }

  // Book reasons first, then the extras, without repeats.
  const reasons = [...new Set([...clean(book.reasons), ...clean(tap.extraReasons)])];

  const song = tap.song && typeof tap.song.url === 'string' && /^https:\/\//.test(tap.song.url)
    ? { label: tap.song.label || 'Our song', url: tap.song.url }
    : null;

  const specialDates = {};
  for (const [k, v] of Object.entries(tap.specialDates || {})) {
    if (/^\d{2}-\d{2}$/.test(k) && typeof v === 'string' && v.trim()) specialDates[k] = v.trim();
  }

  let nextDate = null;
  if (tap.nextDate && tap.nextDate.date) {
    parseDate(tap.nextDate.date);
    nextDate = { date: tap.nextDate.date, label: tap.nextDate.label || 'our next date' };
  }

  return {
    v: 1,
    herName,
    yourName,
    startDate,
    note,
    reasons,
    song,
    specialDates,
    nextDate,
    closingLine: isPlaceholder(book.closingLine) ? '' : (book.closingLine || '')
  };
}

// Caption for a book photo folder such as "05-month-04" (the month's title), if it's been written.
export function captionForBookFolder(folderName, book = {}) {
  const m = /month-(\d+)/.exec(folderName);
  if (!m || !Array.isArray(book.months)) return '';
  const title = book.months[Number(m[1]) - 1]?.title;
  return title && !isPlaceholder(title) ? title : '';
}
