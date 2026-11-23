import {
  keyFromHash, decryptJSON, togetherParts, daysSince, pickOfTheDay, specialsFor, daysUntil, parseDate
} from './core.js';

const KEY_STORE = 'tapcard.key';
const OPENS_STORE = 'tapcard.opens';

// Storage can be missing or throw (private browsing, blocked site data); the page must still work.
const safe = (area) => ({
  get(k) { try { return window[area].getItem(k); } catch { return null; } },
  set(k, v) { try { window[area].setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { window[area].removeItem(k); } catch { /* ignore */ } }
});
const local = safe('localStorage');
const session = safe('sessionStorage');

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?date=YYYY-MM-DD previews another day (for checking special-day messages); the clock keeps ticking.
const clockOffset = (() => {
  const q = new URLSearchParams(location.search).get('date');
  if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q)) return 0;
  const { y, m, d } = parseDate(q);
  const real = new Date();
  return new Date(y, m - 1, d, real.getHours(), real.getMinutes(), real.getSeconds()) - real;
})();
const now = () => new Date(Date.now() + clockOffset);

// Tiny element helper. Text always goes in as textContent, never as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function show(id) {
  for (const s of ['loading', 'locked', 'envelope', 'app']) $(s).hidden = s !== id && !(id === 'envelope' && s === 'app');
  document.body.classList.remove('is-loading');
  document.body.dataset.state = id; // the smoke test waits on this
}

function showLocked(message) {
  if (message) {
    $('lock-msg').textContent = message;
    $('lock-msg').hidden = false;
  }
  show('locked');
}

// ---------- start ----------

async function main() {
  const fromCard = keyFromHash(location.hash);
  const key = fromCard || local.get(KEY_STORE);
  if (!key) return showLocked();

  let bytes;
  try {
    const res = await fetch('payload.bin', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return showLocked('Could not load. Check the internet connection and tap again.');
  }

  let data;
  try {
    data = await decryptJSON(key, bytes);
  } catch {
    if (!fromCard) local.del(KEY_STORE);
    return showLocked(fromCard ? 'This card does not open this page.' : null);
  }

  // Remember the key, and keep it in the link so bookmarks and home-screen icons open straight in
  // (on iPhone a home-screen web app does not share Safari's storage).
  local.set(KEY_STORE, key);
  if (!fromCard) history.replaceState(null, '', `${location.pathname}${location.search}#k=${key}`);

  let opens = Number(local.get(OPENS_STORE)) || 0;
  if (!session.get('counted')) {
    opens += 1;
    local.set(OPENS_STORE, String(opens));
    session.set('counted', '1');
  }

  render(data, opens);

  if (session.get('envelope-opened') || reduceMotion) {
    show('app');
    celebrate(data);
  } else {
    $('envelope-to').textContent = data.herName ? `for ${data.herName}` : 'for you';
    show('envelope');
    $('envelope-btn').addEventListener('click', () => openEnvelope(data), { once: true });
  }
}

function openEnvelope(data) {
  session.set('envelope-opened', '1');
  $('envelope-btn').classList.add('open');
  setTimeout(() => $('envelope').classList.add('gone'), 1000);
  setTimeout(() => {
    $('envelope').hidden = true;
    document.body.dataset.state = 'app';
    celebrate(data);
  }, 1600);
}

// ---------- the page ----------

const fmtToday = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function specialCard(sp) {
  switch (sp.kind) {
    case 'anniversary':
      return el('section', { class: 'card special' },
        el('h2', { text: sp.years === 1 ? 'Happy first anniversary ♡' : `Happy ${ordinal(sp.years)} anniversary ♡` }),
        el('p', { text: sp.years === 1 ? 'A whole year of us. Here\'s to every one after it.' : `${sp.years} years of us.` }));
    case 'monthiversary':
      return el('section', { class: 'card special' },
        el('h2', { text: `${plural(sp.months, 'month')} today ♡` }),
        el('p', { text: 'Happy monthiversary.' }));
    case 'milestone':
      return el('section', { class: 'card special' },
        el('h2', { text: `Day ${sp.days} together ♡` }),
        el('p', { text: `${sp.days} days, and I'd choose you on every one of them.` }));
    default:
      return el('section', { class: 'card special custom' }, el('p', { text: sp.message }));
  }
}

function counterCard(data) {
  const cells = ['days', 'hours', 'mins', 'secs'].map((name) => {
    const b = el('b', { text: '0' });
    return { name, b, node: el('div', { class: 'unit' }, b, el('span', { text: name })) };
  });
  const tick = () => {
    const p = togetherParts(data.startDate, now());
    const values = [p.days, p.hours, p.minutes, p.seconds];
    cells.forEach((c, i) => {
      c.b.textContent = i === 0 ? values[i].toLocaleString() : String(values[i]).padStart(2, '0');
    });
    cells[0].node.lastChild.textContent = values[0] === 1 ? 'day' : 'days';
  };
  tick();
  setInterval(tick, 1000);
  return el('section', { class: 'card counter tilt-l' },
    el('p', { class: 'label', text: 'Together for' }),
    el('div', { class: 'units' }, cells.map((c) => c.node)));
}

function reasonCard(data, day) {
  const n = data.reasons.length;
  if (!n) return null;
  const i = ((day % n) + n) % n;
  return el('section', { class: 'card reason tilt-r' },
    el('p', { class: 'label', text: 'Why I love you, today' }),
    el('blockquote', { text: data.reasons[i] }),
    el('small', { text: `reason ${i + 1} of ${n}, a new one tomorrow` }));
}

function photoCard(data, day) {
  const n = data.photos.length;
  if (!n) return null;
  let i = ((day % n) + n) % n;
  const img = el('img', { alt: '' });
  const caption = el('span');
  const count = el('span', { class: 'count' });
  const fig = el('button', { class: 'polaroid', type: 'button', 'aria-label': 'Next photo' },
    img, el('figcaption', {}, caption, count));
  const paint = () => {
    const p = data.photos[i];
    img.src = p.src;
    caption.textContent = p.caption || '';
    count.textContent = n > 1 ? `${i + 1} / ${n} · tap for another` : '';
  };
  paint();
  if (n > 1) {
    fig.addEventListener('click', () => {
      i = (i + 1) % n;
      fig.classList.remove('swap');
      void fig.offsetWidth; // restart the animation
      fig.classList.add('swap');
      paint();
    });
  }
  return el('section', { class: 'photo' },
    el('p', { class: 'label', text: 'Photo of the day' }),
    fig);
}

function noteCard(note) {
  if (!note || !note.paragraphs || note.paragraphs.length === 0) return null;
  return el('section', { class: 'card note tilt-l' },
    el('p', { class: 'greet', text: note.greeting }),
    note.paragraphs.map((t) => el('p', { text: t })),
    el('p', { class: 'sign' }, note.signoff || '', el('b', { text: note.signature || '' })));
}

function nextCard(data, today) {
  if (!data.nextDate) return null;
  const left = daysUntil(data.nextDate.date, today);
  if (left == null) return null;
  return el('section', { class: 'card next tilt-r' },
    el('p', { class: 'label', text: left === 0 ? 'Today' : 'Counting down' }),
    left === 0
      ? el('b', { text: '♡' })
      : el('b', { text: String(left) }),
    el('p', { text: left === 0 ? `It's ${data.nextDate.label} day!` : `${left === 1 ? 'day' : 'days'} until ${data.nextDate.label}` }));
}

function render(data, opens) {
  const today = now();
  const day = daysSince(data.startDate, today);
  const specials = specialsFor(data.startDate, today, data.specialDates || {});

  const parts = [
    el('p', { class: 'today', text: fmtToday.format(today) }),
    el('h1', { class: 'hello', text: data.herName ? `Hi ${data.herName} ♡` : 'Hi you ♡' }),
    specials.map(specialCard),
    counterCard(data),
    reasonCard(data, day),
    photoCard(data, day),
    noteCard(data.note),
    nextCard(data, today),
    data.song ? el('a', { class: 'song', href: data.song.url, target: '_blank', rel: 'noopener noreferrer' },
      '♫', el('span', { text: data.song.label })) : null,
    data.closingLine ? el('p', { class: 'closing', text: data.closingLine }) : null,
    el('footer', { class: 'foot' },
      el('p', { text: opens > 1 ? `opened ${opens} times ♡` : 'opened for the first time ♡' }),
      opens <= 2 ? el('p', { class: 'tip', text: 'Tip: add this page to your Home Screen to open it without the card.' }) : null)
  ];
  const app = $('app');
  app.replaceChildren(...parts.flat().filter((c) => c != null && c !== false));
  app.dataset.specials = specials.map((s) => s.kind).join(' ');
}

// ---------- confetti on special days ----------

function celebrate(data) {
  const specials = specialsFor(data.startDate, now(), data.specialDates || {});
  if (!specials.length || reduceMotion) return;
  const big = specials.some((s) => s.kind === 'anniversary');
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#d88d98', '#8f4d5a', '#f2c9cc', '#f6e6b8', '#bccdb4', '#d5e3ee'];
  const bits = Array.from({ length: big ? 160 : 60 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    s: 6 + Math.random() * 8,
    vy: 1.6 + Math.random() * 2.4,
    vx: -0.8 + Math.random() * 1.6,
    r: Math.random() * Math.PI,
    vr: -0.08 + Math.random() * 0.16,
    heart: Math.random() < 0.45,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  const heart = (s) => {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(0, 0, -s * 0.5, 0, -s * 0.5, s * 0.3);
    ctx.bezierCurveTo(-s * 0.5, s * 0.6, 0, s * 0.8, 0, s);
    ctx.bezierCurveTo(0, s * 0.8, s * 0.5, s * 0.6, s * 0.5, s * 0.3);
    ctx.bezierCurveTo(s * 0.5, 0, 0, 0, 0, s * 0.3);
    ctx.fill();
  };
  const end = performance.now() + (big ? 6000 : 3500);
  const frame = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;
    for (const b of bits) {
      b.y += b.vy; b.x += b.vx; b.r += b.vr;
      if (b.y < innerHeight + 20) alive = true;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      if (b.heart) heart(b.s * 1.4); else ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (alive && t < end) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

main();
