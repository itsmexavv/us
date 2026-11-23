// Makes the sticker for the front of the NFC card. Run:  npm run label
//   card-label.pdf         one card, 85.6 x 54 mm plus 2 mm bleed, for a print shop
//   card-label-sheet.pdf   eight cards on A4 with cut lines, for sticker paper at home

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runEdge, killStrayEdge } from './edge.mjs';
import { loadWords } from '../lib/load.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { book, tap } = loadWords(root);
let name = tap.herName ?? book?.herName ?? '';
if (/\[[^\]]+\]/.test(name)) {
  console.warn('  ! Her name is still a placeholder in the book; the label will just say ♡ for now.');
  name = '';
}

const page = pathToFileURL(path.join(root, 'label', 'label.html')).href;
const jobs = [
  ['card-label.pdf', `?to=${encodeURIComponent(name)}`],
  ['card-label-sheet.pdf', `?to=${encodeURIComponent(name)}&sheet`]
];
try {
  for (const [file, query] of jobs) {
    const out = path.join(root, file);
    fs.rmSync(out, { force: true });
    await runEdge(['--no-pdf-header-footer', '--virtual-time-budget=5000', '--allow-file-access-from-files',
      `--print-to-pdf=${out}`, `${page}${query}`]);
    if (!fs.existsSync(out)) throw new Error(`Edge did not make ${file}`);
    console.log(`${file}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
} finally {
  killStrayEdge();
}
