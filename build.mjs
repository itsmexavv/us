// Builds the encrypted page content and the link to write to the NFC card.
// Run:  npm run build
//
// Reads   ../anniversary-book/content.js and photos/   (words and photos shared with the book)
//         content/tap.js and content/photos/           (card-only extras; never uploaded)
//         secret.key                                   (made on the first run; never uploaded)
// Writes  docs/payload.bin   the encrypted content the page downloads
//         docs/icon.png      the home-screen icon (only if missing)
//         TAG-URL.txt        the link to write to the card

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  encryptJSON, newKeyString, isValidKeyString, findPlaceholders,
  ndefMessageBytes, NTAG213_NDEF_BYTES
} from './docs/core.js';
import { assemble, captionForBookFolder } from './lib/assemble.mjs';
import { loadWords } from './lib/load.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(root, ...p);

const PHOTO_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PHOTO_LONG_EDGE = 1280;
const PAYLOAD_WARN_MB = 8;

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`); };

// ---------- 0. safety: the private files must be gitignored ----------
const ignore = fs.readFileSync(at('.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
for (const must of ['content/', 'secret.key', 'TAG-URL.txt']) {
  if (!ignore.includes(must)) {
    console.error(`Stopped: .gitignore must contain "${must}" so the private files never get uploaded.`);
    process.exit(1);
  }
}

// ---------- 1. words ----------
if (!fs.existsSync(at('content', 'tap.js'))) {
  fs.mkdirSync(at('content', 'photos'), { recursive: true });
  fs.copyFileSync(at('content-template', 'tap.js'), at('content', 'tap.js'));
  console.log('Made content/tap.js from the template. Fill it in and build again.');
}
fs.mkdirSync(at('content', 'photos'), { recursive: true });

const { config, bookDir, bookFile, book: loadedBook, tap } = loadWords(root);
const book = loadedBook || {};
if (loadedBook) console.log(`Words: ${path.relative(root, bookFile)} + content/tap.js`);
else warn(`No book found at ${bookFile}; using content/tap.js only.`);
const text = assemble(book, tap);

// ---------- 2. photos ----------
function listPhotos() {
  const found = [];
  const bookPhotos = path.join(bookDir, 'photos');
  const scan = (dir, captionFor) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const ext = path.extname(f.name).toLowerCase();
      if (ext === '.heic' || ext === '.heif') {
        warn(`Skipped ${path.relative(root, path.join(dir, f.name))}: convert HEIC photos to JPG first.`);
      } else if (PHOTO_TYPES.has(ext)) {
        found.push({ file: path.join(dir, f.name), caption: captionFor(f.name) });
      }
    }
  };
  if (fs.existsSync(bookPhotos)) {
    for (const d of fs.readdirSync(bookPhotos, { withFileTypes: true }).filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      scan(path.join(bookPhotos, d.name), () => captionForBookFolder(d.name, book));
    }
  }
  const captions = tap.photoCaptions || {};
  scan(at('content', 'photos'), (name) => (typeof captions[name] === 'string' ? captions[name] : ''));
  return found;
}

const photos = [];
for (const p of listPhotos()) {
  try {
    const buf = await sharp(p.file)
      .rotate() // respect the phone's orientation flag
      .resize({ width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    photos.push({ src: `data:image/jpeg;base64,${buf.toString('base64')}`, caption: p.caption });
  } catch (e) {
    warn(`Could not read ${path.relative(root, p.file)}: ${e.message}`);
  }
}
console.log(`Photos: ${photos.length}`);

// ---------- 3. key ----------
const keyFile = at('secret.key');
let key;
if (fs.existsSync(keyFile)) {
  key = fs.readFileSync(keyFile, 'utf8').trim();
  if (!isValidKeyString(key)) {
    console.error('Stopped: secret.key is damaged. Restore it from your backup (or delete it to make a new one and rewrite the card).');
    process.exit(1);
  }
} else {
  key = newKeyString();
  fs.writeFileSync(keyFile, key + '\n');
  console.log('\nMade a new secret.key. Back it up somewhere safe (a password manager is ideal).');
  console.log('If it is lost, the card has to be rewritten with a new link.\n');
}

// ---------- 4. encrypt ----------
const payload = { ...text, photos, builtAt: new Date().toISOString() };
const bytes = await encryptJSON(key, payload);
fs.writeFileSync(at('docs', 'payload.bin'), bytes);
const mb = bytes.length / 1048576;
console.log(`docs/payload.bin: ${mb.toFixed(2)} MB (encrypted)`);
if (mb > PAYLOAD_WARN_MB) warn(`The payload is over ${PAYLOAD_WARN_MB} MB and will load slowly on mobile data. Use fewer photos.`);

// ---------- 5. icon ----------
if (!fs.existsSync(at('docs', 'icon.png'))) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <rect width="180" height="180" fill="#f8e1e0"/>
    <path d="M90 146 C40 112 26 86 26 64 C26 44 42 30 61 30 C74 30 84 37 90 48 C96 37 106 30 119 30 C138 30 154 44 154 64 C154 86 140 112 90 146 Z" fill="#d88d98"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(at('docs', 'icon.png'));
  console.log('Made docs/icon.png');
}

// ---------- 6. the link for the card ----------
const url = `${config.siteUrl}#k=${key}`;
fs.writeFileSync(at('TAG-URL.txt'), url + '\n');
const ndef = ndefMessageBytes(url);
console.log(`\nLink for the card (also saved in TAG-URL.txt):\n  ${url}`);
console.log(`NFC size: ${ndef} bytes; an NTAG213 holds ${NTAG213_NDEF_BYTES}, NTAG215 and NTAG216 hold more.`);
if (ndef > NTAG213_NDEF_BYTES) warn('The link is too long for an NTAG213 card; use an NTAG215 or NTAG216.');

// ---------- 7. is it ready to give? ----------
const left = findPlaceholders(text);
if (left.length) {
  console.log(`\nStill to write: ${left.length} placeholder(s)`);
  for (const p of left.slice(0, 25)) console.log(`  - ${p.path}: ${p.text}`);
  if (left.length > 25) console.log(`  ... and ${left.length - 25} more`);
}
if (photos.length === 0) console.log('\nNo photos yet: add them to the book\'s photos/ folders or to content/photos/.');
console.log(left.length === 0 && photos.length > 0 && warnings.length === 0
  ? '\nReady to give.'
  : '\nBuilt, but not ready to give yet (see above).');
