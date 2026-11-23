// Loads the book's words (window.BOOK) and the card extras (window.TAP) from their script files.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function loadWindowScript(file, globalName) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.window[globalName] || {};
}

export function loadWords(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
  const bookDir = path.resolve(root, config.bookFolder);
  const bookFile = path.join(bookDir, 'content.js');
  const tapFile = path.join(root, 'content', 'tap.js');
  return {
    config,
    bookDir,
    bookFile,
    book: fs.existsSync(bookFile) ? loadWindowScript(bookFile, 'BOOK') : null,
    tap: fs.existsSync(tapFile) ? loadWindowScript(tapFile, 'TAP') : {}
  };
}
