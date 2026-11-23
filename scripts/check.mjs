// Safety checks before publishing. Run:  npm run check   (after npm run build)
// Fails if anything private could end up on the public site.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decryptJSON, isValidKeyString, ndefMessageBytes, NTAG213_NDEF_BYTES, findPlaceholders } from '../docs/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
let failed = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => { failed++; console.log(`  FAIL  ${msg}`); };

// 1. The payload opens with the key, so the card's link works.
const key = fs.existsSync(at('secret.key')) ? fs.readFileSync(at('secret.key'), 'utf8').trim() : '';
if (!isValidKeyString(key)) { console.log('No valid secret.key: run npm run build first.'); process.exit(1); }
const payloadBytes = fs.readFileSync(at('docs', 'payload.bin'));
let data;
try {
  data = await decryptJSON(key, new Uint8Array(payloadBytes));
  ok('docs/payload.bin opens with secret.key');
} catch {
  bad('docs/payload.bin does not open with secret.key (run npm run build)');
  process.exit(1);
}

// 2. No private words anywhere in the published folder, encrypted or not.
const privateStrings = [
  data.herName, data.yourName,
  ...(data.reasons || []),
  ...((data.note && data.note.paragraphs) || []),
  ...Object.values(data.specialDates || {}),
  data.closingLine,
  ...(data.photos || []).map((p) => p.caption)
].filter((s) => typeof s === 'string' && s.trim().length >= 3 && !/^\[[^\]]+\]$/.test(s.trim()))
  .map((s) => s.trim());
const published = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else published.push(p);
  }
};
walk(at('docs'));
// Text files: whole-word matches (so a name like "Tim" doesn't trip on "setTimeout").
// Binary files (ciphertext, fonts, icon): short strings turn up in random bytes by chance, so look
// only for strings of 8+ characters and for the payload's own JSON keys, which would mean it's unencrypted.
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.txt', '.md', '.webmanifest']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plainMarkers = ['"herName":', '"reasons":', '"startDate":'];
let leaks = 0;
for (const file of published) {
  const buf = fs.readFileSync(file);
  const rel = path.relative(root, file);
  if (TEXT_EXT.has(path.extname(file).toLowerCase())) {
    const text = buf.toString('utf8');
    for (const s of privateStrings) {
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(s)}($|[^\\p{L}\\p{N}])`, 'u').test(text)) {
        leaks++; bad(`"${s.slice(0, 40)}" appears in ${rel}`);
      }
    }
  } else {
    const asText = [buf.toString('latin1'), buf.toString('utf16le')];
    const utf8 = buf.toString('utf8');
    for (const s of [...privateStrings.filter((x) => Buffer.byteLength(x) >= 8), ...plainMarkers]) {
      if (utf8.includes(s) || asText.some((t) => t.includes(s))) { leaks++; bad(`"${s.slice(0, 40)}" appears in ${rel}`); }
    }
  }
}
if (!leaks) ok(`none of ${privateStrings.length} private strings appear in the ${published.length} published files`);
if (fs.readFileSync(at('docs', 'index.html'), 'utf8').includes(key)) bad('the key appears in docs/index.html');

// 3. The private files are never uploaded.
const mustIgnore = ['content/tap.js', 'secret.key', 'TAG-URL.txt'];
const isRepo = fs.existsSync(at('.git'));
for (const f of mustIgnore) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', f], { cwd: root, stdio: 'ignore' }); // needs `git init`
    ok(`${f} is gitignored`);
  } catch {
    bad(`${f} is NOT gitignored`);
  }
}
if (isRepo) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  const oops = tracked.filter((f) => f.startsWith('content/') || f === 'secret.key' || f === 'TAG-URL.txt');
  if (oops.length) bad(`private files are committed: ${oops.join(', ')}`);
  else ok('no private files are committed');
}

// 4. The link fits a small card.
const url = fs.readFileSync(at('TAG-URL.txt'), 'utf8').trim();
const size = ndefMessageBytes(url);
if (!url.endsWith(`#k=${key}`)) bad('TAG-URL.txt does not match secret.key (run npm run build)');
else if (size > NTAG213_NDEF_BYTES) bad(`the card link is ${size} bytes, more than an NTAG213 holds (${NTAG213_NDEF_BYTES})`);
else ok(`the card link is ${size} bytes and fits an NTAG213`);

// For information: is it ready to give?
const left = findPlaceholders({ ...data, photos: undefined });
console.log(`\n  info  ${left.length} placeholder(s) left, ${data.photos.length} photo(s), ${data.reasons.length} reason(s)`);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
