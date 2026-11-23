// Opens the real page in headless Edge on an iPhone-sized screen and checks every way it can be opened.
// Run:  npm run smoke   (after npm run build). Screenshots are saved as smoke-*.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, baseUrl } from './serve.mjs';
import { launchBrowser, killStrayEdge } from './edge.mjs';
import { decryptJSON, newKeyString } from '../docs/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = fs.readFileSync(path.join(root, 'secret.key'), 'utf8').trim();
const data = await decryptJSON(key, new Uint8Array(fs.readFileSync(path.join(root, 'docs', 'payload.bin'))));

// Preview the first anniversary so the special-day banner and confetti code run too.
const s = data.startDate.split('-').map(Number);
const anniversary = `${s[0] + 1}-${String(s[1]).padStart(2, '0')}-${String(s[2]).padStart(2, '0')}`;

let failed = 0;
const check = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const shots = ['smoke-locked.png', 'smoke-envelope.png', 'smoke-page.png'];
for (const f of shots) fs.rmSync(path.join(root, f), { force: true });
const shotPath = (f) => path.join(root, f);

const READY = `['locked', 'envelope', 'app'].includes(document.body.dataset.state) && document.body.dataset.state`;

// Opens a page and waits until it settles on a screen. Some Windows setups refuse a small share of
// local requests (net::ERR_NETWORK_ACCESS_DENIED); if that's what went wrong, reload once.
async function open(page, url) {
  const before = page.failedRequests.length;
  const settle = async () => {
    const state = await page.waitFor(READY);
    const msg = await page.evaluate(`document.getElementById('lock-msg').textContent`);
    if (state === 'locked' && msg.startsWith('Could not load')) throw new Error(`page said: ${msg}`);
    return state;
  };
  try {
    await page.goto(url);
    return await settle();
  } catch (e) {
    const refused = page.failedRequests.slice(before);
    if (!refused.length) throw e;
    console.log(`  note  this PC refused a local request (${refused.join('; ')}), reloading once`);
    await page.reload();
    return settle();
  }
}
const server = await startServer(0);
const base = baseUrl(server);
const browser = await launchBrowser();
try {
  console.log('No key (someone who only has the link):');
  {
    const page = await (await browser.newContext()).newPage();
    check(await open(page, base) === 'locked', 'shows the locked screen');
    check(await page.evaluate(`document.getElementById('app').children.length`) === 0, 'loads none of the page');
    check(!data.herName || !(await page.evaluate('document.body.innerText')).includes(data.herName), 'does not show her name');
    await page.screenshot(shotPath('smoke-locked.png'));
  }

  console.log('Wrong key:');
  {
    const page = await (await browser.newContext()).newPage();
    check(await open(page, `${base}#k=${newKeyString()}`) === 'locked', 'shows the locked screen');
    const msg = await page.evaluate(`document.getElementById('lock-msg').textContent`);
    check(msg === 'This card does not open this page.', `says the card does not match (it said: "${msg}")`);
  }

  console.log('Tapping the card:');
  const ctx = await browser.newContext();
  {
    const page = await ctx.newPage();
    check(await open(page, `${base}#k=${key}`) === 'envelope', 'shows the envelope first');
    check(!data.herName || (await page.evaluate(`document.getElementById('envelope-to').textContent`)).includes(data.herName),
      'the envelope has her name on it');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot(shotPath('smoke-envelope.png'));
    await page.evaluate(`document.getElementById('envelope-btn').click()`);
    check(await page.waitFor(`document.body.dataset.state === 'app'`, 5000), 'opening the envelope reveals the page');
    check(await page.evaluate(`localStorage.getItem('tapcard.key')`) === key, 'her phone remembers the key');
  }

  console.log('Opening later without the card (same phone):');
  {
    const page = await ctx.newPage();
    check(await open(page, base) !== 'locked', 'opens without a tap');
    check(await page.evaluate('location.hash') === `#k=${key}`, 'puts the key back in the link, so a home-screen icon works');
  }

  console.log(`The page itself, previewing ${anniversary}:`);
  {
    const page = await (await browser.newContext()).newPage({ reducedMotion: true });
    check(await open(page, `${base}?date=${anniversary}#k=${key}`) === 'app', 'skips the envelope when reduced motion is on');
    const text = await page.evaluate(`document.getElementById('app').innerText`);
    check(!data.herName || text.includes(`Hi ${data.herName}`), 'greets her by name');
    check(/anniversary/.test(await page.evaluate(`document.getElementById('app').dataset.specials`)), 'shows the anniversary banner');
    check(/together for/i.test(text), 'shows the counter');
    check(data.reasons.length === 0 || /why i love you, today/i.test(text), 'shows a reason of the day');
    check(data.photos.length === 0 || await page.evaluate(`!!document.querySelector('.polaroid img[src^="data:image/jpeg"]')`), 'shows a photo of the day');
    check(!/\[object |\bnull\b|\bundefined\b/.test(text), 'no stray "[object ...]", "null" or "undefined" text');
    const overflow = await page.evaluate('document.documentElement.scrollWidth - innerWidth');
    check(overflow <= 0, `nothing spills off the side of a 390 px screen (${overflow} px)`);
    await page.screenshot(shotPath('smoke-page.png'), { fullPage: true });
  }

  for (const f of shots) check(fs.existsSync(shotPath(f)), `saved ${f}`);
} catch (e) {
  failed++;
  console.log(`  FAIL  ${e.message}`);
} finally {
  await browser.close();
  server.close();
  killStrayEdge();
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nSmoke test passed.');
process.exit(failed ? 1 : 0);
