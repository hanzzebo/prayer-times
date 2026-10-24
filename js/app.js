import { I18N } from './i18n.js';
import { sec, computeNext } from './next.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
const store = {
  get(k) { try { return localStorage.getItem('js.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('js.' + k, v); } catch (e) {} },
};
const restart = (el, cls) => { if (RM || !el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

/* ---------- language ---------- */
let LANG = store.get('lang') || ((navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en');
const t = (k, v = {}) => (I18N[LANG][k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const LOC = () => (LANG === 'id' ? 'id-ID' : 'en-GB');

/* ---------- time in the selected city's zone (not the phone's) ---------- */
const TZ = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' };
const fmtCache = {};
function zoned(zone, date = new Date()) {
  const f = fmtCache[zone] || (fmtCache[zone] = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ[zone], hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }));
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, s: (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second };
}
const doy = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5;
const shift = (y, m, d, n) => { const x = new Date(Date.UTC(y, m - 1, d + n)); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const utcNoon = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d, 12));
const fmtDur = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const dateFmt = (opts, cal) => new Intl.DateTimeFormat(LOC() + (cal ? '-u-ca-' + cal : ''), { timeZone: 'UTC', ...opts });

/* ---------- prayers ---------- */
const KEYS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
const ICON = {
  imsak: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M5 8l2 2M19 8l-2 2"/>',
  subuh: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M5 8l2 2M19 8l-2 2"/>',
  terbit: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 10V5M9 8l3-3 3 3"/>',
  dzuhur: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  ashar: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  maghrib: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 5v5M9 7l3 3 3-3"/>',
  isya: '<path d="M20 15a8 8 0 1 1-9-11 6 6 0 0 0 9 11z"/>',
};
const pname = (i) => t('pr.' + KEYS[i]);

/* ---------- data ---------- */
let CITIES = [];
const yearCache = new Map();
async function loadYear(id, y) {
  const key = `${y}/${id}`;
  if (!yearCache.has(key)) {
    const p = fetch(`data/${key}.json`)
      .then((r) => (r.ok ? r.json() : r.status === 404 ? null : undefined))
      .catch(() => undefined);
    p.then((v) => { if (v === undefined) yearCache.delete(key); }); // retry later instead of caching a failure
    yearCache.set(key, p);
  }
  return yearCache.get(key); // json, null (not published) or undefined (network failure)
}
async function timesFor(id, date) {
  const y = await loadYear(id, date.y);
  return y && y.days ? y.days[doy(date.y, date.m, date.d)] || null : y;
}

/* ---------- city choice: saved, else estimated from the device time zone ---------- */
const TZ_ZONE = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };
const ZONE_PICK = { WIB: /^Kota Jakarta/, WITA: /^Kota Makassar/, WIT: /^Kota Jayapura/ };
let city = null, estimated = false, zoneFilter = 'WIB';
const cityById = (id) => CITIES.find((c) => c.id === id);
const shortName = (n) => n.replace(/^Kota\s+/, '');
function initialCity() {
  const saved = cityById(store.get('city'));
  if (saved) return saved;
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  const zone = TZ_ZONE[tz] || 'WIB';
  estimated = true;
  return CITIES.find((c) => c.z === zone && ZONE_PICK[zone].test(c.n)) || CITIES.find((c) => c.z === zone) || CITIES[0];
}

/* ---------- toast ---------- */
let toastTimer, toastFn, toastWait = 0;
const toastEl = $('#toast');
function toast(msg, action) {
  $('#tmsg').textContent = msg;
  toastFn = action && action.fn;
  $('#tact').textContent = action ? action.label : '';
  $('#tact').style.display = action ? '' : 'none';
  toastEl.classList.remove('drag');
  toastEl.style.transform = toastEl.style.opacity = '';
  toastEl.classList.add('show');
  toastWait = action && action.sticky ? 0 : action ? 4500 : 2400;
  armToast();
}
function armToast() { clearTimeout(toastTimer); if (toastWait) toastTimer = setTimeout(hideToast, toastWait); }
function hideToast() { clearTimeout(toastTimer); toastEl.classList.remove('show', 'drag'); toastEl.style.transform = toastEl.style.opacity = ''; }
$('#tact').addEventListener('click', () => { if (toastFn) toastFn(); hideToast(); });
$('#tx').addEventListener('click', hideToast);
// swipe up or sideways to dismiss; the timer pauses while the toast is held or hovered
let drag = null;
toastEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || !toastEl.classList.contains('show')) return;
  drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
  clearTimeout(toastTimer);
  toastEl.classList.add('drag');
  toastEl.setPointerCapture(e.pointerId);
});
toastEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.dx = e.clientX - drag.x;
  drag.dy = Math.min(0, e.clientY - drag.y);
  toastEl.style.transform = `translate(calc(-50% + ${drag.dx}px), ${drag.dy}px)`;
  toastEl.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(drag.dx) / 200, -drag.dy / 80)));
});
function endDrag() {
  if (!drag) return;
  const { dx, dy } = drag;
  drag = null;
  toastEl.classList.remove('drag');
  if (Math.abs(dx) > 80 || dy < -32) {
    toastEl.style.opacity = '0';
    toastEl.style.transform = Math.abs(dx) > 80 ? `translate(calc(-50% + ${Math.sign(dx) * 120}%), 0)` : 'translate(-50%, -140%)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 220);
    buzz(6);
  } else {
    toastEl.style.transform = toastEl.style.opacity = '';
    armToast();
  }
}
toastEl.addEventListener('pointerup', endDrag);
toastEl.addEventListener('pointercancel', endDrag);
toastEl.addEventListener('mouseenter', () => clearTimeout(toastTimer));
toastEl.addEventListener('mouseleave', () => { if (!drag && toastEl.classList.contains('show')) armToast(); });

/* ---------- today state ---------- */
const state = { today: null, times: null, tmrw: null, yday: null, next: -1, selOffset: 0, phase: '', status: 'loading' };
const SKY_OVERRIDE = new URLSearchParams(location.search).get('sky'); // ?sky=dawn|day|dusk|night to preview

async function loadToday() {
  const c0 = city, z = zoned(c0.z);
  state.today = { y: z.y, m: z.m, d: z.d };
  const [a, b, c] = await Promise.all([timesFor(c0.id, state.today), timesFor(c0.id, shift(z.y, z.m, z.d, 1)), timesFor(c0.id, shift(z.y, z.m, z.d, -1))]);
  if (city !== c0) return; // city changed while loading
  state.times = a || null; state.tmrw = b || null; state.yday = c || null;
  state.status = a ? 'ok' : a === undefined ? 'offline' : 'nodata';
  state.next = -1; state.phase = '';
  renderStatic(); tick(true);
}

function phaseOf(s) {
  const T = state.times;
  if (s < sec(T[1]) || s >= sec(T[6])) return 'night';
  if (s < sec(T[2]) + 1200) return 'dawn';
  if (s < sec(T[5]) - 2700) return 'day';
  return 'dusk';
}

/* sun along the arc, sunrise to sunset */
const A = { x0: 10, y0: 76, cx: 170, cy: -16, x1: 330, y1: 76 };
let sunT = -1, sunAnim;
function drawSun(k) {
  const u = 1 - k, x = u * u * A.x0 + 2 * u * k * A.cx + k * k * A.x1, y = u * u * A.y0 + 2 * u * k * A.cy + k * k * A.y1;
  const qx = A.x0 + k * (A.cx - A.x0), qy = A.y0 + k * (A.cy - A.y0);
  $('#sun').setAttribute('x', (x - 24).toFixed(1)); $('#sun').setAttribute('y', (y - 24).toFixed(1));
  $('#sunpath').setAttribute('d', `M${A.x0} ${A.y0} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`);
}
function moveSun(to) {
  if (Math.abs(to - sunT) < 0.002) return;
  cancelAnimationFrame(sunAnim);
  if (RM || sunT < 0) { sunT = to; drawSun(to); return; }
  const from = sunT, start = performance.now(), dur = 1400;
  (function step(now) { const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3); sunT = from + (to - from) * e; drawSun(sunT); if (k < 1) sunAnim = requestAnimationFrame(step); })(start);
}

const SKY_TOP = { dawn: '#2B3A67', day: '#1F67A3', dusk: '#33284F', night: '#070D1F' };
function setPhaseClass(ph) {
  $('#sky').className = 'hdr sky-' + ph;
  document.body.classList.remove('ph-dawn', 'ph-day', 'ph-dusk', 'ph-night');
  document.body.classList.add('ph-' + ph);
  $('#themecolor').setAttribute('content', SKY_TOP[ph]);
}
let lastCount = '';
function tick(force) {
  if (!city) return;
  const z = zoned(city.z);
  if (state.today && (z.d !== state.today.d || z.m !== state.today.m)) return loadToday(); // midnight rollover
  if (state.status !== 'ok') return;
  const T = state.times, s = z.s;

  const ph = SKY_OVERRIDE && /^(dawn|day|dusk|night)$/.test(SKY_OVERRIDE) ? SKY_OVERRIDE : phaseOf(s);
  if (ph !== state.phase) { state.phase = ph; setPhaseClass(ph); }
  const rise = sec(T[2]), set = sec(T[5]), up = ph !== 'night' && s >= rise - 1800 && s <= set + 1800;
  $('#sun').style.opacity = up ? 1 : 0; $('#sunpath').style.opacity = up ? 1 : 0;
  moveSun(Math.min(1, Math.max(0, (s - rise) / (set - rise))));

  const n = computeNext(T, state.yday, state.tmrw, s);
  if (n.i !== state.next || force) {
    const changed = state.next !== -1 && n.i !== state.next;
    state.next = n.i; state.nextTomorrow = n.tomorrow;
    $('#hnext').textContent = t('next', { n: pname(n.i) });
    $('#htime').textContent = n.tomorrow ? (state.tmrw ? state.tmrw[1] : '--:--') : T[n.i];
    $('#htmrw').textContent = n.tomorrow ? t('tomorrow') : '';
    $('#mname2').textContent = `${pname(n.i)} ${$('#htime').textContent}`;
    if (changed) { restart($('#hnext'), 'swap'); restart($('#htime'), 'swap'); buzz(10); }
    if (state.selOffset === 0) drawList();
  }

  if (n.target == null) { $('#hcount').textContent = '--:--:--'; return; }
  const left = Math.max(0, n.target - s), txt = fmtDur(left);
  $('#hcount').innerHTML = [...txt].map((c, i) => (lastCount && c !== lastCount[i] && !RM ? `<span class="digit">${c}</span>` : c)).join('');
  lastCount = txt;
  $('#mcount').textContent = `${t('in')} ${txt}`;
  $('#sky').classList.toggle('is-soon', left <= 1800);
  const bar = $('.pr.next .bar');
  if (bar) bar.style.width = Math.min(100, Math.max(0, ((s - n.prev) / (n.target - n.prev)) * 100)).toFixed(2) + '%';
}

/* a traveller leading a camel walks along the progress bar. Every limb is its own group pivoting on
   its joint (hip or shoulder, then knee), so CSS can run a real walk cycle */
const WALKER = '<span class="walk">'
  + '<svg width="65" height="34" viewBox="0 0 92 48" fill="currentColor" stroke="currentColor" stroke-linecap="round"><g class="cm"><g class="ct cf far" style="transform-origin:34px 25.5px"><line x1="34" y1="25.5" x2="34" y2="35.8" stroke-width="3.2"/><g class="sh" style="transform-origin:34px 35.8px"><line x1="34" y1="35.8" x2="34" y2="45.6" stroke-width="2.3"/><line x1="33.4" y1="45.6" x2="35.6" y2="45.6" stroke-width="2.2"/></g></g><g class="ct ch far" style="transform-origin:14px 24.5px"><line x1="14" y1="24.5" x2="14" y2="35.4" stroke-width="3.6"/><g class="sh" style="transform-origin:14px 35.4px"><line x1="14" y1="35.4" x2="14" y2="45.6" stroke-width="2.3"/><line x1="13.4" y1="45.6" x2="15.6" y2="45.6" stroke-width="2.2"/></g></g><path stroke="none" d="M8 23.5C7 17 13 12 19 10C24 4 31 5 34 12C35.5 15.5 38 17.5 41 19C44 20.5 46 22.5 48 20C50 17 51 11 53 8C54 6 56 5.5 58 6.5L62 8.5C63.5 9.2 63.5 11 62 11.3L57 12C55.5 12.3 55 13.5 54.6 15C53.6 19 52.6 22.6 49.4 25C46 27 43 27.2 40 27.6C33 28.6 22 28.6 17 28.2C12 27.8 9 26.8 8 23.5Z"/><path stroke="none" d="M54 7.2L54.6 4.6L56.3 6.6Z"/><path fill="none" stroke-width="1.3" d="M8.4 21.5Q6.2 25 6.4 30"/><g class="ct cf" style="transform-origin:38px 25.5px"><line x1="38" y1="25.5" x2="38" y2="35.8" stroke-width="3.2"/><g class="sh" style="transform-origin:38px 35.8px"><line x1="38" y1="35.8" x2="38" y2="45.6" stroke-width="2.3"/><line x1="37.4" y1="45.6" x2="39.6" y2="45.6" stroke-width="2.2"/></g></g><g class="ct ch" style="transform-origin:18px 24.5px"><line x1="18" y1="24.5" x2="18" y2="35.4" stroke-width="3.6"/><g class="sh" style="transform-origin:18px 35.4px"><line x1="18" y1="35.4" x2="18" y2="45.6" stroke-width="2.3"/><line x1="17.4" y1="45.6" x2="19.6" y2="45.6" stroke-width="2.2"/></g></g></g><g class="mn"><g class="mb"><path class="far" fill="none" stroke-width="2.6" stroke-linejoin="round" d="M76.6 21.2L73.4 25.8L70.8 27.4"/><path fill="none" stroke-width="0.8" d="M70.8 27.4Q64.5 25.5 62.4 11.6"/><g class="mt far" style="transform-origin:75.6px 30.5px"><line x1="75.6" y1="30.5" x2="75.6" y2="38.3" stroke-width="3.8"/><g class="sh" style="transform-origin:75.6px 38.3px"><line x1="75.6" y1="38.3" x2="75.6" y2="45.6" stroke-width="3.2"/><line x1="75.0" y1="45.6" x2="78.19999999999999" y2="45.6" stroke-width="2.2"/></g></g><circle stroke="none" cx="77.2" cy="15.2" r="3.4"/><line x1="76.8" y1="20.4" x2="75.7" y2="30" stroke-width="6.2"/><g class="mt" style="transform-origin:75.6px 30.5px"><line x1="75.6" y1="30.5" x2="75.6" y2="38.3" stroke-width="3.8"/><g class="sh" style="transform-origin:75.6px 38.3px"><line x1="75.6" y1="38.3" x2="75.6" y2="45.6" stroke-width="3.2"/><line x1="75.0" y1="45.6" x2="78.19999999999999" y2="45.6" stroke-width="2.2"/></g></g><g class="ma" style="transform-origin:76.9px 21.2px"><line x1="76.9" y1="21.2" x2="76.9" y2="27" stroke-width="2.8"/><g style="transform-origin:76.9px 27px;transform:rotate(-24deg)"><line x1="76.9" y1="27" x2="76.9" y2="31.6" stroke-width="2.5"/></g></g></g></g></svg>'
  + '</span>';

/* ---------- rendering ---------- */
function renderStatic() {
  const td = state.today;
  $('#today').textContent = dateFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(utcNoon(td));
  let hijri = '';
  try { hijri = dateFmt({ day: 'numeric', month: 'long', year: 'numeric' }, 'islamic-umalqura').format(utcNoon(td)); } catch (e) {}
  $('#hijri').textContent = hijri ? t('hijri', { d: hijri }) : '';
  $('#rise').textContent = state.times ? state.times[2] : '--:--';
  $('#set').textContent = state.times ? state.times[5] : '--:--';
  if (state.status !== 'ok') {
    $('#hnext').textContent = ''; $('#htime').textContent = '--:--'; $('#htmrw').textContent = ''; $('#hcount').textContent = '--:--:--';
    $('#sun').style.opacity = 0; $('#sunpath').style.opacity = 0;
  }
  drawWeek(); drawList();
}

async function drawList() {
  const box = $('#list');
  if (state.status === 'loading') { box.innerHTML = `<p class="state">${t('loading')}</p>`; return; }
  const off = state.selOffset, isToday = off === 0;
  let T = state.times;
  if (!isToday) {
    T = await timesFor(city.id, shift(state.today.y, state.today.m, state.today.d, off));
    if (state.selOffset !== off) return; // another day was picked while loading
  }
  if (!T) {
    const y = isToday ? state.today.y : shift(state.today.y, state.today.m, state.today.d, state.selOffset).y;
    box.innerHTML = `<p class="state">${T === undefined || state.status === 'offline' ? t('offlinenodata') : t('nodata', { y })}</p>`;
    return;
  }
  const now = zoned(city.z).s, nxt = isToday && !state.nextTomorrow ? state.next : -1;
  box.innerHTML = KEYS.map((k, i) => {
    const cls = !isToday ? '' : nxt === i ? 'next' : (sec(T[i]) <= now ? 'past' : '');
    const sub = nxt === i ? t('sub.next') : (k === 'imsak' || k === 'terbit') ? t('sub.' + k) : '';
    return `<div class="pr ${cls}" style="--i:${i}">
<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${ICON[k]}</svg>
<span class="nm">${pname(i)}${sub ? `<small>${sub}</small>` : ''}</span>
<span class="tm">${T[i]}</span>${nxt === i ? '<span class="bar" aria-hidden="true">' + WALKER + '</span>' : ''}</div>`;
  }).join('');
  tick();
}

/* week strip around today (in the city's zone) */
function slide(ind, el, box) { if (!ind || !el) return; const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); ind.style.width = r.width + 'px'; ind.style.transform = `translateX(${r.left - b.left}px)`; }
const placeWeek = () => slide($('#week .ind'), $('.wd[aria-pressed="true"]'), $('#week'));
const placeTab = () => slide($('.tabbar .ind'), $('.tab[aria-selected="true"]'), $('.tabbar'));
function drawWeek() {
  const td = state.today, wd = dateFmt({ weekday: 'short' }), full = dateFmt({ weekday: 'long', day: 'numeric', month: 'long' });
  $('#week').innerHTML = '<span class="ind" aria-hidden="true"></span>' + [-3, -2, -1, 0, 1, 2, 3].map((o) => {
    const d = shift(td.y, td.m, td.d, o), dt = utcNoon(d);
    return `<button class="wd" data-o="${o}" aria-pressed="${o === state.selOffset}" aria-label="${full.format(dt)}"><span>${wd.format(dt).replace('.', '')}</span><b>${d.d}</b></button>`;
  }).join('');
  requestAnimationFrame(placeWeek);
}
$('#week').addEventListener('click', (e) => {
  const b = e.target.closest('.wd');
  if (!b || b.getAttribute('aria-pressed') === 'true') return;
  state.selOffset = +b.dataset.o;
  $$('.wd').forEach((x) => x.setAttribute('aria-pressed', x === b));
  placeWeek(); buzz(6); drawList();
});

/* ---------- location ---------- */
const CHK = '<svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const esc = (x) => x.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function drawCities() {
  if (!CITIES.length) { $('#cities').innerHTML = `<p class="empty">${t('city.loadfail')}</p>`; return; }
  const raw = $('#q').value, q = norm(raw.trim());
  $('#q').closest('.field').classList.toggle('has', !!raw);
  const list = CITIES.filter((c) => (q ? norm(c.n).includes(q) || norm(c.p).includes(q) : c.z === zoneFilter))
    .sort((a, b) => a.p.localeCompare(b.p, 'id') || a.n.localeCompare(b.n, 'id'));
  $('#zones').classList.toggle('dim', !!q); // search covers every zone
  $('#count').textContent = q ? t(list.length === 1 ? 'city.result1' : 'city.results', { n: list.length }) : t('city.count', { n: list.length, z: zoneFilter });
  let html = '', prov = '', i = 0;
  for (const c of list) {
    if (c.p !== prov) { prov = c.p; html += `<div class="grp">${esc(prov)}${q ? ' · ' + c.z : ''}</div>`; }
    const me = c.id === city.id;
    html += `<button class="city" style="--i:${Math.min(i++, 12)}" aria-current="${me}" data-id="${c.id}"><span>${esc(c.n)}</span><small>${me ? t('city.active') : ''}</small></button>`;
  }
  $('#cities').innerHTML = list.length ? html : `<p class="empty">${t('city.empty', { q: esc(raw) })}</p>`;
}
function setZone(z) { zoneFilter = z; $$('#zones button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.z === z)); }
function renderLoc(animate) {
  $('#locname').textContent = shortName(city.n);
  $('#loczone').textContent = city.z;
  if (animate) { restart($('#locname'), 'swap'); restart($('#loczone'), 'swap'); }
  $('#locbtn').setAttribute('aria-label', t('aria.loc', { c: shortName(city.n), z: city.z }));
  $('#mloc').textContent = `${shortName(city.n)} · ${city.z}`;
  $('#curcity').textContent = t('city.current', { c: city.n, p: city.p, z: city.z });
  $('#notice').hidden = !estimated;
}
function applyCity(c, { save = true, animate = true } = {}) {
  city = c;
  if (save) { store.set('city', c.id); estimated = false; }
  setZone(c.z); renderLoc(animate); drawCities();
  state.selOffset = 0; state.status = 'loading'; drawList();
  loadToday(); drawMonth();
  // fetch next year too, so it is cached for offline use near the turn of the year
  const z = zoned(c.z); loadYear(c.id, z.y + 1);
}
function pickCity(c) {
  if (c.id === city.id && !estimated) return go('home');
  const prev = { c: city, est: estimated };
  setTimeout(() => {
    applyCity(c); go('home'); restart($('#locbtn'), 'pulse');
    toast(t('t.city', { c: shortName(c.n) }), { label: t('undo'), fn: () => { applyCity(prev.c, { save: !prev.est }); estimated = prev.est; renderLoc(true); if (!prev.est) store.set('city', prev.c.id); } });
  }, RM ? 0 : 380);
}
$('#q').addEventListener('input', drawCities);
$('#qclear').addEventListener('click', () => { $('#q').value = ''; drawCities(); $('#q').focus(); });
$('#zones').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setZone(b.dataset.z); $('#q').value = ''; drawCities(); $('#cities').scrollTop = 0; buzz(6); });
$('#cities').addEventListener('click', (e) => {
  const b = e.target.closest('.city'); if (!b) return;
  const s = b.querySelector('small'); if (s) s.outerHTML = CHK;
  buzz(10); pickCity(cityById(b.dataset.id));
});

/* optional GPS: permission is only requested on tap; coordinates are matched on-device and discarded */
function nearest(lat, lon) {
  const R = Math.PI / 180; let best = null, bd = Infinity;
  for (const c of CITIES) {
    if (c.lat == null) continue;
    const dLat = (c.lat - lat) * R, dLon = (c.lon - lon) * R;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * R) * Math.cos(c.lat * R) * Math.sin(dLon / 2) ** 2;
    if (a < bd) { bd = a; best = c; }
  }
  return best;
}
let gpsBusy = false;
function gpsMsg(text) { const m = $('#gpsmsg'); m.textContent = text || t('gps.note'); m.classList.toggle('msg', !!text); }
$('#gps').addEventListener('click', () => {
  if (gpsBusy) return;
  const g = $('#gps'), icon = g.querySelector('svg');
  const done = (msg) => {
    gpsBusy = false; g.removeAttribute('aria-busy'); const sp = g.querySelector('.spin'); if (sp) sp.remove();
    icon.style.display = ''; $('#gpslabel').textContent = t('gps.btn'); gpsMsg(msg);
  };
  if (!('geolocation' in navigator)) return done(t('gps.unavail'));
  gpsBusy = true; g.setAttribute('aria-busy', 'true'); icon.style.display = 'none';
  g.insertAdjacentHTML('afterbegin', '<i class="spin" aria-hidden="true"></i>');
  $('#gpslabel').textContent = t('gps.busy'); gpsMsg(t('gps.busy'));
  navigator.geolocation.getCurrentPosition((pos) => {
    const c = nearest(pos.coords.latitude, pos.coords.longitude);
    if (!c) return done(t('gps.unavail'));
    done(t('gps.found', { c: shortName(c.n) })); buzz(10); pickCity(c);
  }, (err) => done(t(err.code === 1 ? 'gps.denied' : err.code === 3 ? 'gps.timeout' : 'gps.unavail')),
  { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
});

/* ---------- month ---------- */
let mView = null, mData = null;
const MP = [[1, 'subuh'], [3, 'dzuhur'], [4, 'ashar'], [5, 'maghrib'], [6, 'isya']];
async function drawMonth(dir) {
  if (!city) return;
  if (!mView) { const z = zoned(city.z); mView = { y: z.y, m: z.m }; }
  const { y, m } = mView;
  $('#mname').textContent = dateFmt({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 15)));
  if (dir) restart($('#mname'), 'swap');
  const c0 = city, grid = $('#days'), data = await loadYear(c0.id, y);
  if (city !== c0 || mView.y !== y || mView.m !== m) return;
  mData = data;
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate(), z = zoned(city.z), here = z.y === y && z.m === m;
  if (!mView.d || mView.d > n) mView.d = here ? z.d : 1;
  // Monday-first week; 2024-01-01 was a Monday
  const wd = dateFmt({ weekday: 'short' }), lead = (utcNoon({ y, m, d: 1 }).getUTCDay() + 6) % 7, full = dateFmt({ weekday: 'long', day: 'numeric', month: 'long' });
  grid.innerHTML = Array.from({ length: 7 }, (_, i) => `<span class="wd" aria-hidden="true">${wd.format(utcNoon({ y: 2024, m: 1, d: i + 1 }))}</span>`).join('')
    + '<span></span>'.repeat(lead)
    + Array.from({ length: n }, (_, i) => {
      const d = i + 1, cls = here && d === z.d ? 'today' : here && d < z.d || y * 12 + m < z.y * 12 + z.m ? 'past' : '';
      return `<button type="button" class="cday ${cls}" data-d="${d}" aria-pressed="${d === mView.d}" aria-label="${full.format(utcNoon({ y, m, d }))}">${d}</button>`;
    }).join('');
  drawDay();
  if (dir && !RM) { grid.className = 'cgrid'; void grid.offsetWidth; grid.className = 'cgrid ' + (dir > 0 ? 'from-right' : 'from-left'); }
}
function drawDay() {
  const { y, m, d } = mView, box = $('#mday'), z = zoned(city.z);
  if (!mData) { box.innerHTML = `<p class="state">${mData === undefined ? t('offlinenodata') : t('nodata', { y })}</p>`; return; }
  const T = mData.days[doy(y, m, d)], today = z.y === y && z.m === m && z.d === d;
  box.innerHTML = `<h2>${dateFmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(utcNoon({ y, m, d }))}${today ? ' · ' + t('month.today') : ''}</h2>`
    + MP.map(([k, p]) => `<div class="mrow"><span>${t('pr.' + p)}</span><b>${T ? T[k] : '--:--'}</b></div>`).join('');
}
$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('.cday'); if (!b) return;
  mView.d = +b.dataset.d;
  $$('#days .cday').forEach((x) => x.setAttribute('aria-pressed', x === b));
  drawDay(); buzz(5);
});
$('#prev').onclick = () => { mView.d = 0; mView.m--; if (mView.m < 1) { mView.m = 12; mView.y--; } drawMonth(-1); };
$('#next').onclick = () => { mView.d = 0; mView.m++; if (mView.m > 12) { mView.m = 1; mView.y++; } drawMonth(1); };

/* ---------- navigation ---------- */
const ORDER = ['home', 'month', 'city'];
let cur = 'home';
function go(id) {
  if (id === cur) return;
  const dir = ORDER.indexOf(id) > ORDER.indexOf(cur) ? 'from-right' : 'from-left';
  cur = id;
  $$('.screen').forEach((s) => { s.classList.remove('on', 'from-right', 'from-left'); if (s.id === id) s.classList.add('on', dir); });
  $$('.tab').forEach((x) => x.setAttribute('aria-selected', x.dataset.go === id));
  document.body.classList.toggle('on-city', id === 'city');
  placeTab(); window.scrollTo(0, 0); $('#mini').classList.remove('show');
  if (id === 'home') requestAnimationFrame(placeWeek);
  if (id === 'city') { setZone(city.z); $('#q').value = ''; gpsMsg(); drawCities(); const box = $('#cities'), me = box.querySelector('.city[aria-current="true"]'); box.scrollTop = me ? me.offsetTop - box.clientHeight / 2 + me.offsetHeight / 2 : 0; }
  if (id === 'month') { const z = zoned(city.z); mView = { y: z.y, m: z.m }; drawMonth(); }
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
new IntersectionObserver(([e]) => $('#mini').classList.toggle('show', cur === 'home' && !e.isIntersecting), { rootMargin: '-120px 0px 0px 0px' }).observe($('#sky'));

/* ---------- theme ---------- */
$('#theme').addEventListener('click', (e) => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const apply = () => { r.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', r.dataset.theme); };
  buzz(8);
  if (!document.startViewTransition || RM) return apply();
  const b = e.currentTarget.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
  const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(apply).ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
    { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }));
});

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  $$('[data-i18n-label]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.i18nLabel)));
  $$('[data-i18n-ph]').forEach((e) => e.setAttribute('placeholder', t(e.dataset.i18nPh)));
  $('#langcode').textContent = LANG.toUpperCase();
  $('#lang').setAttribute('aria-label', t('aria.lang'));
  $('#arc').setAttribute('aria-label', t('aria.arc'));
  $('#hin').textContent = t('in');
  if (!$('#gps').hasAttribute('aria-busy')) $('#gpslabel').textContent = t('gps.btn');
  gpsMsg();
  net();
  if (city) { renderLoc(false); drawCities(); if (state.today) renderStatic(); state.next = -1; tick(true); drawMonth(); }
  requestAnimationFrame(placeTab);
}
$('#lang').addEventListener('click', () => { LANG = LANG === 'id' ? 'en' : 'id'; store.set('lang', LANG); applyLang(); buzz(6); toast(t('t.lang')); });

/* ---------- connection ---------- */
function net() { const n = $('#net'); if (navigator.onLine) { n.classList.remove('show'); return; } n.textContent = t('offline'); n.classList.add('show'); }
addEventListener('online', () => { net(); toast(t('t.online')); if (state.status === 'offline') { yearCache.clear(); loadToday(); } });
addEventListener('offline', net);

/* ---------- install prompt (Android/desktop Chromium; iOS uses Share > Add to Home Screen) ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#install').classList.add('show'); });
$('#install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#install').classList.remove('show'); });
addEventListener('appinstalled', () => $('#install').classList.remove('show'));

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Installed apps on phones usually resume from the background instead of relaunching, so the browser
  // rarely checks for a new version on its own. Check whenever the app comes back to the foreground,
  // and swap to the new version with a reload at a moment the user won't be interrupted.
  const hadController = !!navigator.serviceWorker.controller;
  const bootAt = Date.now();
  let pendingReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install: nothing old to replace
    if (document.hidden || Date.now() - bootAt < 8000) location.reload(); // in the background, or just opened
    else pendingReload = true; // mid-use: wait until the app is left or reopened
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state !== 'installed') return;
        if (!navigator.serviceWorker.controller) toast(t('t.offline'));
      });
    });
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => {
      if (pendingReload) return location.reload();
      if (!document.hidden) check();
    });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}

/* ---------- boot ---------- */
$('#stars').innerHTML = Array.from({ length: 34 }, (_, i) => `<i class="${i % 5 ? '' : 'b'}" style="left:${(i * 37) % 100}%;top:${(i * 53) % 100}%;animation-delay:${(i % 7) * 0.45}s"></i>`).join('');
applyLang();
drawList();
try {
  const res = await fetch('data/cities.json');
  if (!res.ok) throw new Error(res.status);
  CITIES = await res.json();
} catch (e) { CITIES = []; }
if (CITIES.length) {
  applyCity(initialCity(), { save: false, animate: false });
} else {
  state.status = 'offline'; $('#locname').textContent = '—'; drawCities();
  $('#list').innerHTML = `<p class="state">${t('city.loadfail')}</p>`;
}
setInterval(() => tick(), 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
addEventListener('resize', () => { placeWeek(); placeTab(); });
if (document.fonts) document.fonts.ready.then(() => { placeWeek(); placeTab(); });
