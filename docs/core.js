// Shared logic with no DOM: used by the page (app.js), the build (build.mjs) and the tests.
// Works in browsers and in Node 18+ (both have WebCrypto, btoa and atob).

export const KEY_BYTES = 32;      // AES-256
export const IV_BYTES = 12;       // AES-GCM standard nonce
export const KEY_CHARS = 43;      // 32 bytes in base64url without padding

// ---------- base64url ----------

export function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isValidKeyString(s) {
  return typeof s === 'string' && s.length === KEY_CHARS && /^[A-Za-z0-9_-]+$/.test(s);
}

// Reads the key from a location.hash such as "#k=abc...". Returns null if there is none.
export function keyFromHash(hash) {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m && isValidKeyString(m[1]) ? m[1] : null;
}

// ---------- AES-GCM ----------

export function newKeyString() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

async function importKey(keyString) {
  if (!isValidKeyString(keyString)) throw new Error('Bad key');
  return crypto.subtle.importKey('raw', b64urlDecode(keyString), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Returns IV followed by ciphertext (which ends with the 16-byte auth tag).
export async function encryptJSON(keyString, obj) {
  const key = await importKey(keyString);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

// Throws if the key is wrong or the bytes were changed.
export async function decryptJSON(keyString, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < IV_BYTES + 16) throw new Error('Payload too short');
  const key = await importKey(keyString);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, IV_BYTES) }, key, data.subarray(IV_BYTES));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- dates (all local calendar dates, so daylight saving never shifts a day) ----------

export function parseDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) throw new Error(`Date must look like YYYY-MM-DD, got "${ymd}"`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function dayNumber(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// Whole calendar days from the start date to "now" (0 on the day itself, negative before).
export function daysSince(startYmd, now) {
  const s = parseDate(startYmd);
  return dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate()) - dayNumber(s.y, s.m, s.d);
}

// "Together for X days, Y hours, Z minutes", counting from midnight on the start date.
export function togetherParts(startYmd, now) {
  return {
    days: Math.max(0, daysSince(startYmd, now)),
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds()
  };
}

// Same item all day, a new one tomorrow; every item shows once per cycle of list.length days.
export function pickOfTheDay(list, day) {
  if (!list || list.length === 0) return null;
  const n = list.length;
  return list[((day % n) + n) % n];
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Everything worth celebrating today. Returns a list (often empty), most important first.
// Kinds: anniversary, monthiversary, milestone (every 100 days), custom (from specialDates).
export function specialsFor(startYmd, now, specialDates = {}) {
  const s = parseDate(startYmd);
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const out = [];
  const days = daysSince(startYmd, now);
  if (days <= 0) return out;

  // A start on the 29th to 31st is celebrated on the last day of shorter months.
  const effectiveDay = (yy, mm) => Math.min(s.d, daysInMonth(yy, mm));

  if (m === s.m && d === effectiveDay(y, m)) {
    out.push({ kind: 'anniversary', years: y - s.y });
  } else if (d === effectiveDay(y, m)) {
    const months = (y - s.y) * 12 + (m - s.m);
    if (months > 0) out.push({ kind: 'monthiversary', months });
  }
  if (days % 100 === 0) out.push({ kind: 'milestone', days });

  const custom = specialDates[`${pad2(m)}-${pad2(d)}`];
  if (custom) out.push({ kind: 'custom', message: custom });
  return out;
}

// Days until a future date (0 = today). Null when it has passed or is missing.
export function daysUntil(targetYmd, now) {
  if (!targetYmd) return null;
  const t = parseDate(targetYmd);
  const diff = dayNumber(t.y, t.m, t.d) - dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return diff >= 0 ? diff : null;
}

// ---------- NFC ----------

// Size of an NDEF message holding one short URI record, as written by NFC Tools.
// "https://" (and "https://www.") are stored as a single prefix byte.
export function ndefMessageBytes(url) {
  let rest = url;
  if (url.startsWith('https://www.')) rest = url.slice(12);
  else if (url.startsWith('https://')) rest = url.slice(8);
  const payload = 1 + new TextEncoder().encode(rest).length;   // prefix code + rest
  const header = payload <= 255 ? 4 : 7;                       // flags, type length, payload length, "U"
  return header + payload;
}

export const NTAG213_NDEF_BYTES = 137;

// ---------- placeholders ----------

// Lists every string still holding a "[placeholder]", with where it was found.
export function findPlaceholders(value, path = '') {
  const found = [];
  if (typeof value === 'string') {
    if (/\[[^\]]+\]/.test(value)) found.push({ path: path || '(root)', text: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findPlaceholders(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) found.push(...findPlaceholders(v, path ? `${path}.${k}` : k));
  }
  return found;
}
