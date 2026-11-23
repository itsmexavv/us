// Drives headless Microsoft Edge for the smoke test and the card label.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PROFILE_MARK = 'tap-card-edge';

export function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  const edge = candidates.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('Microsoft Edge was not found.');
  return edge;
}

// Runs one headless Edge job in a fresh profile and returns what it printed to stdout.
export function runEdge(args, { timeoutMs = 60000 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `${PROFILE_MARK}-`));
  return new Promise((resolve, reject) => {
    const child = spawn(findEdge(), [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', `--user-data-dir=${profile}`, ...args
    ], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Edge timed out')); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold it */ }
      resolve(out);
    });
  });
}

// Starts headless Edge and talks to it over the DevTools protocol, so a test can wait for the page
// to say it's ready (WebCrypto work isn't seen by --virtual-time-budget) and emulate a phone screen.
// The protocol runs over pipes (fd 3 in, fd 4 out) rather than a local socket, because some
// Windows setups block loopback sockets from time to time.
export async function launchBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `${PROFILE_MARK}-`));
  const child = spawn(findEdge(), [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toEdge = child.stdio[3];
  const fromEdge = child.stdio[4];
  child.on('error', () => { /* reported by the first command timing out */ });

  let nextId = 0;
  const pending = new Map();
  const waiters = new Set(); // one-shot listeners for protocol events
  let buf = '';
  fromEdge.setEncoding('utf8');
  fromEdge.on('data', (chunk) => {
    buf += chunk;
    let end;
    while ((end = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, end);
      buf = buf.slice(end + 1);
      onMessage(JSON.parse(raw));
    }
  });
  const listeners = new Set(); // lasting listeners for protocol events
  const onMessage = (msg) => {
    if (msg.method) {
      for (const l of listeners) if (l.method === msg.method && l.sessionId === msg.sessionId) l.cb(msg.params);
      for (const w of [...waiters]) {
        if (w.method === msg.method && w.sessionId === msg.sessionId) { waiters.delete(w); w.resolve(msg.params); }
      }
      return;
    }
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    toEdge.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const nextEvent = (method, sessionId, timeoutMs) => new Promise((resolve, reject) => {
    const w = { method, sessionId, resolve };
    waiters.add(w);
    setTimeout(() => { if (waiters.delete(w)) reject(new Error(`No ${method} within ${timeoutMs} ms`)); }, timeoutMs);
  });
  const withTimeout = (promise, ms, what) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms))
  ]);

  // Each context is like a separate private window. Pages in the same context share localStorage.
  async function newContext() {
    const { browserContextId } = await send('Target.createBrowserContext');
    return {
      async newPage({ width = 390, height = 844, reducedMotion = false } = {}) {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const s = (m, p) => send(m, p, sessionId);
        // Remember requests that failed, so a test can tell a refused connection from a real bug.
        const failedRequests = [];
        const urls = new Map();
        listeners.add({ method: 'Network.requestWillBeSent', sessionId, cb: (p) => urls.set(p.requestId, p.request.url) });
        listeners.add({ method: 'Network.loadingFailed', sessionId, cb: (p) => failedRequests.push(`${urls.get(p.requestId) || '?'}: ${p.errorText}`) });
        await s('Network.enable');
        await s('Page.enable');
        await s('Runtime.enable');
        await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        if (reducedMotion) {
          await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        }
        const evaluate = async (expression) => {
          const r = await withTimeout(s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), 3000, 'evaluate');
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
          return r.result.value;
        };
        return {
          failedRequests,
          // Resolves once the new page has fired its load event.
          async goto(url) {
            const loaded = nextEvent('Page.loadEventFired', sessionId, 20000);
            await s('Page.navigate', { url });
            await loaded;
          },
          async reload() {
            const loaded = nextEvent('Page.loadEventFired', sessionId, 20000);
            await s('Page.reload', { ignoreCache: true });
            await loaded;
          },
          evaluate,
          async waitFor(expression, timeoutMs = 20000) {
            const end = Date.now() + timeoutMs;
            let last;
            while (Date.now() < end) {
              try { const v = await evaluate(expression); if (v) return v; last = v; } catch (e) { last = e.message; }
              await new Promise((r) => setTimeout(r, 100));
            }
            let where = '';
            try { where = await evaluate(`location.href + ' | state=' + document.body.dataset.state + ' | ' + document.body.innerText.slice(0, 120)`); } catch { /* ignore */ }
            const failures = failedRequests.length ? `; failed requests: ${failedRequests.join(', ')}` : '';
            throw new Error(`Timed out waiting for: ${expression} (last: ${last}; page: ${where}${failures})`);
          },
          async screenshot(file, { fullPage = false } = {}) {
            let params = { format: 'png' };
            if (fullPage) {
              const m = await s('Page.getLayoutMetrics');
              const size = m.cssContentSize || m.contentSize;
              params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(size.height), scale: 1 } };
            }
            const { data } = await s('Page.captureScreenshot', params);
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
          }
        };
      }
    };
  }

  const close = async () => {
    try { await withTimeout(send('Browser.close'), 3000, 'Browser.close'); } catch { /* already closing */ }
    await new Promise((r) => { if (child.exitCode !== null) r(); else { child.once('exit', r); setTimeout(r, 5000); } });
    if (child.exitCode === null) child.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold it */ }
  };

  try {
    await withTimeout(send('Browser.getVersion'), 30000, 'Starting Edge');
  } catch (e) {
    await close();
    killStrayEdge();
    throw e;
  }
  return { newContext, close };
}

// Headless Edge can leave helper processes behind; close only the ones these scripts started.
export function killStrayEdge() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like '*${PROFILE_MARK}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ], { stdio: 'ignore' });
  } catch { /* nothing to clean */ }
}
