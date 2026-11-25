import { I18N } from './i18n.js';
import { sec, computeNext } from './times.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
const store = {
  get(k) { try { return localStorage.getItem('js.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('js.' + k, v); } catch (e) {} },
};
const restart = (el, cls) => { if (RM || !el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

/* ---------- city pages (scripts/build-pages.mjs): the page names its city and language ---------- */
const PAGE_CITY = document.documentElement.dataset.city || null;
const PAGE_LANG = document.documentElement.lang;
const SECTIONS = { id: 'jadwal-sholat/', en: 'en/prayer-times/' }; // same paths as build-pages.mjs

/* ---------- language ---------- */
// English first; a city page keeps its own language so its text and the app agree
let LANG = store.get('lang') || (PAGE_CITY ? PAGE_LANG : 'en');
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
  const page = cityById(PAGE_CITY);
  if (page) return page;
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
// kick: the small gold label above the message, as on an achievement banner
function toast(msg, action, kick = '') {
  $('#tmsg').textContent = msg;
  $('#tkick').textContent = kick;
  toastEl.classList.remove('show'); void toastEl.offsetWidth; // replay the opening when a toast replaces another
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
const state = { today: null, times: null, tmrw: null, yday: null, next: -1, selOffset: 0, status: 'loading' };
const AR = ['', 'الفجر', '', 'الظهر', 'العصر', 'المغرب', 'العشاء'];
const ART = { 1: 'fajr', 3: 'dhuhr', 4: 'asr', 5: 'maghrib', 6: 'isha' };
const PRAYER_IDX = [1, 3, 4, 5, 6];
const PREVIEW = new URLSearchParams(location.search).get('prayer'); // ?prayer=fajr|dhuhr|asr|maghrib|isha to preview a painting

async function loadToday() {
  const c0 = city, z = zoned(c0.z);
  state.today = { y: z.y, m: z.m, d: z.d };
  const [a, b, c] = await Promise.all([timesFor(c0.id, state.today), timesFor(c0.id, shift(z.y, z.m, z.d, 1)), timesFor(c0.id, shift(z.y, z.m, z.d, -1))]);
  if (city !== c0) return; // city changed while loading
  state.times = a || null; state.tmrw = b || null; state.yday = c || null;
  state.status = a ? 'ok' : a === undefined ? 'offline' : 'nodata';
  state.next = -1;
  renderStatic(); tick(true);
}

/* the next prayer's painting arrives as its line drawing on the construction grid, then fills in */
let artName = '', artTimer;
function setArt(name, animate) {
  if (name === artName) return;
  const first = !artName;
  artName = name;
  // text over the painting follows the sky, not the app theme: only the Isha painting is dark
  $('#sky').dataset.sky = name === 'isha' ? 'dark' : 'light';
  const art = $('#sky .art'), old = $('#paint0'), paint = $('#paint'), lines = $('#lines');
  clearTimeout(artTimer);
  // the outgoing painting stays underneath while the new outline wipes in over it
  if (!first) { old.src = paint.src; old.classList.add('in'); }
  paint.classList.remove('in');
  lines.src = `assets/senja/${name}-lines.webp`;
  paint.src = `assets/senja/${name}.webp`;
  if (RM || !animate) { paint.classList.add('in'); old.classList.remove('in'); return; }
  art.classList.remove('drawing'); void art.offsetWidth; art.classList.add('drawing');
  artTimer = setTimeout(() => {
    paint.classList.add('in');
    artTimer = setTimeout(() => { old.classList.remove('in'); art.classList.remove('drawing'); }, 2200);
  }, 1500);
}

/* "1 hr 2 min" style, rounded up so it never reads 0 min before the time */
function human(s) {
  const m = Math.ceil(s / 60), h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? t('dur.hm', { h, m: r }) : t('dur.h', { h })) : t('dur.m', { m: r });
}

let lastMin = -1;
const BASE_TITLE = document.title;
function tick(force) {
  if (!city) return;
  const z = zoned(city.z);
  if (state.today && (z.d !== state.today.d || z.m !== state.today.m)) return loadToday(); // midnight rollover
  if (state.status !== 'ok') return;
  const T = state.times, s = z.s;

  const n = computeNext(T, state.yday, state.tmrw, s);
  if (n.i !== state.next || force) {
    const changed = state.next !== -1 && n.i !== state.next;
    state.next = n.i; state.nextTomorrow = n.tomorrow;
    $('#hname').textContent = pname(n.i);
    $('#har').textContent = AR[n.i];
    $('#htime').textContent = n.tomorrow ? (state.tmrw ? state.tmrw[1] : '--:--') : T[n.i];
    $('#htmrw').textContent = n.tomorrow ? t('tomorrow') : '';
    $('#mname2').textContent = `${pname(n.i)} ${$('#htime').textContent}`;
    setArt(PREVIEW && Object.values(ART).includes(PREVIEW) ? PREVIEW : ART[n.i], changed || !artName); // also draws in when the app opens
    if (changed) { restart($('.plate'), 'swap'); buzz(10); }
    if (state.selOffset === 0) drawList();
    drawFive();
    lastMin = -1;
  }

  if (n.target == null) { $('#hcount').textContent = ''; $('#ringmin').textContent = ''; document.title = BASE_TITLE; return; }
  const left = Math.max(0, n.target - s), min = Math.ceil(left / 60);
  const k = Math.min(1, Math.max(0, (s - n.prev) / (n.target - n.prev)));
  $('#sky').classList.toggle('is-soon', left <= 1800);
  const bar = $('.pr.next .bar');
  if (bar) bar.style.width = (k * 100).toFixed(2) + '%';
  if (min === lastMin && !force) return;
  lastMin = min;
  $('#hcount').textContent = human(left);
  $('#mcount').textContent = `${t('in')} ${human(left)}`;
  document.title = `${pname(n.i)} ${t('in')} ${human(left)} · ${BASE_TITLE}`;
  $('#ringmin').textContent = min >= 60 ? Math.floor(min / 60) + 'h' : min + 'm';
  $('#ringarc').setAttribute('stroke-dasharray', `${(k * 100).toFixed(1)} 100`);
  drawSun(s);
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
  $('#hijri').textContent = hijri;
  if (state.status !== 'ok') {
    $('#hname').textContent = '—'; $('#har').textContent = ''; $('#htime').textContent = '--:--'; $('#htmrw').textContent = ''; $('#hcount').textContent = '';
  }
  $('#hdate').textContent = [$('#today').textContent, hijri].filter(Boolean).join(' · ') + ', ' + city.n;
  drawList(); drawSun(); drawQibla(); drawFive(); drawTable();
}

/* desktop: the five paintings in a row; hover or focus shows each one as its line drawing */
function drawFive() {
  const T = state.times;
  $$('.five .th').forEach((el) => {
    const k = +el.dataset.k, li = el.parentNode;
    el.setAttribute('aria-label', t('five.show', { n: pname(k) }));
    li.querySelector('.thn').textContent = pname(k);
    li.querySelector('.tht').textContent = T ? T[k] : '';
    li.classList.toggle('next', !state.nextTomorrow && state.next === k);
  });
}

/* desktop: the whole month as a table; the arrows move a month and rows slide in from that side */
let tView = null;
async function drawTable(dir) {
  if (!city || !state.today) return;
  if (!tView || !dir) tView = { y: state.today.y, m: state.today.m };
  const { y, m } = tView, c0 = city, box = $('#tbody');
  const title = dateFmt({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 15)));
  $('#mtitle').textContent = title;
  const data = await loadYear(c0.id, y);
  if (city !== c0 || tView.y !== y || tView.m !== m) return;
  if (!data) { box.innerHTML = `<p class="state">${data === undefined ? t('offlinenodata') : t('nodata', { y })}</p>`; return; }
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate(), td = state.today, wd = dateFmt({ weekday: 'short' });
  const slide = dir ? (dir > 0 ? 'row-r' : 'row-l') : '';
  // this month: days more than 3 before today fold away behind a "show earlier days" row
  const here = y === td.y && m === td.m, cut = here ? td.d - 3 : 0, folded = Math.max(0, cut - 1);
  const rows = Array.from({ length: n }, (_, i) => {
    const d = i + 1, T = data.days[doy(y, m, d)] || [], when = (y * 13 + m) * 32 + d - ((td.y * 13 + td.m) * 32 + td.d);
    const cls = [slide, when === 0 ? 'today' : when < 0 ? 'past' : '', d < cut ? 'old' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}" style="animation-delay:${Math.max(0, i - folded) * 18}ms"><th scope="row">${wd.format(utcNoon({ y, m, d })).replace('.', '')} ${d}</th>${KEYS.map((_, j) => `<td>${T[j] || '--:--'}</td>`).join('')}</tr>`;
  }).join('');
  const more = folded ? `<tr class="more"><td colspan="8"><button type="button" aria-expanded="false" data-n="${folded}">${t('table.more', { n: folded })}</button></td></tr>` : '';
  box.innerHTML = `<table><caption class="sr">${t('table.cap', { m: title, c: city.n, z: city.z })}</caption><thead><tr><th scope="col">${t('table.date')}</th>${KEYS.map((_, j) => `<th scope="col">${pname(j)}</th>`).join('')}</tr></thead><tbody>${more}${rows}</tbody></table>`;
  stickTops();
}
$('#tbody').addEventListener('click', (e) => {
  const b = e.target.closest('.more button'); if (!b) return;
  const open = b.getAttribute('aria-expanded') !== 'true', tb = b.closest('table');
  tb.classList.toggle('open', open);
  b.setAttribute('aria-expanded', open);
  b.textContent = t(open ? 'table.less' : 'table.more', { n: b.dataset.n });
  buzz(5);
});
/* desktop: the month title and the column heads stay pinned under the top bar while the table scrolls */
function stickTops() {
  const r = document.documentElement.style, rail = $('.rail'), head = $('.mthead');
  r.setProperty('--railh', (DESK.matches ? rail.offsetHeight : 0) + 'px');
  r.setProperty('--mthh', head.offsetHeight + 'px');
}
$('#tprev').onclick = () => { tView.m--; if (tView.m < 1) { tView.m = 12; tView.y--; } drawTable(-1); };
$('#tnext').onclick = () => { tView.m++; if (tView.m > 12) { tView.m = 1; tView.y++; } drawTable(1); };

/* imsak and sunrise are not prayers: one line under the date. The five prayers are numbered steps */
const extraLine = (T) => (T ? `${t('pr.imsak')} ${T[0]} · ${t('pr.terbit')} ${T[2]}` : '');
const stepsHtml = (T, { now = null, nxt = -1 } = {}) => PRAYER_IDX.map((k, i) => {
  const cls = nxt === k ? 'next' : now != null && sec(T[k]) <= now ? 'past' : '';
  return `<li class="pr ${cls}" style="--i:${i}"><span class="num" aria-hidden="true">0${i + 1}</span>`
    + `<span class="nm">${pname(k)}<span class="ar" lang="ar" dir="rtl">${AR[k]}</span></span>`
    + `<span class="tm">${T[k]}</span>${nxt === k ? '<span class="bar" aria-hidden="true">' + WALKER + '</span>' : ''}</li>`;
}).join('');

async function drawList() {
  const box = $('#list'), loading = state.status === 'loading';
  $('#sky').classList.toggle('loading', loading);
  if (loading) {
    // the page being drafted: numbered rings and dotted guide lines where the prayers will be
    $('#hname').textContent = t('loading');
    box.innerHTML = [42, 46, 38, 58, 44].map((w, i) => `<li class="pr guide" aria-hidden="true"><span class="num">0${i + 1}</span><i class="rule" style="width:${w}%"></i><i class="rule"></i></li>`).join('');
    $('#extra').textContent = ''; return;
  }
  const off = state.selOffset, isToday = off === 0;
  let T = state.times;
  if (!isToday) {
    T = await timesFor(city.id, shift(state.today.y, state.today.m, state.today.d, off));
    if (state.selOffset !== off) return; // another day was picked while loading
  }
  $('#extra').textContent = extraLine(T);
  if (!T) {
    const y = isToday ? state.today.y : shift(state.today.y, state.today.m, state.today.d, state.selOffset).y;
    box.innerHTML = `<li class="state">${T === undefined || state.status === 'offline' ? t('offlinenodata') : t('nodata', { y })}</li>`;
    return;
  }
  box.innerHTML = isToday ? stepsHtml(T, { now: zoned(city.z).s, nxt: state.nextTomorrow ? -1 : state.next }) : stepsHtml(T);
  tick();
}

/* ---------- the sun today: arc from sunrise to sunset, prayer marks on the horizon ---------- */
// as in the design: the x axis runs 04:00 to 20:00 across 1000 units; the arc runs sunrise to sunset, peak y 30, horizon y 170
const HALF_SUN = (fill) => `<svg aria-hidden="true" viewBox="0 0 64 64"><path class="gd" d="M8 32 A24 24 0 0 1 56 32"/><path class="g" d="M16 32 A16 16 0 0 1 48 32"/><path d="M22 32 A10 10 0 0 1 42 32 Z" fill="${fill}"/><line class="r" x1="32" y1="2" x2="32" y2="8"/></svg>`;
const RAYS = Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6, c = Math.cos(a), s = Math.sin(a); return `<line x1="${(36 + 28 * c).toFixed(1)}" y1="${(36 + 28 * s).toFixed(1)}" x2="${(36 + 32 * c).toFixed(1)}" y2="${(36 + 32 * s).toFixed(1)}"/>`; }).join('');
const FULL_SUN = `<svg aria-hidden="true" viewBox="0 0 72 72"><circle class="gd" cx="36" cy="36" r="34"/><circle class="g" cx="36" cy="36" r="24"/><g class="r">${RAYS}</g><circle class="disc" cx="36" cy="36" r="17"/></svg>`;
const SHIFT = { 1: '-20%', 5: '-78%', 6: '-22%' };
const MOON = `<svg aria-hidden="true" viewBox="0 0 72 72"><circle class="gd" cx="36" cy="36" r="34"/><circle class="g" cx="36" cy="36" r="24"/><g class="r">${RAYS}</g><circle class="mdisc" cx="36" cy="36" r="17"/><circle class="mcut" cx="43" cy="31" r="15"/></svg>`;
/* the night chart board: x runs 18:00 to 05:00 (660 min) over 1000 units; the arc spans Maghrib to Fajr */
function drawNight(box, s, mg, is, fj) {
  const xOf = (v) => ((v / 60 - 1080) / 660) * 1000, x0 = xOf(mg), x1 = xOf(fj), mid = (x0 + x1) / 2;
  const arc = (x) => { const u = Math.min(1, Math.max(0, (x - x0) / (x1 - x0))); return { u, y: 170 - 4 * u * (1 - u) * 140 }; };
  const len = fj - mg, half = mg + len / 2, third = mg + (len * 2) / 3;
  const nowX = Math.min(x1, Math.max(x0, xOf(s))), { u } = arc(nowX);
  const done = `<path class="arcdone" d="M${x0.toFixed(1)} 170 Q${(x0 + u * (mid - x0)).toFixed(1)} ${(170 + u * -280).toFixed(1)} ${nowX.toFixed(1)} ${arc(nowX).y.toFixed(1)}"/>`;
  const ticks = [is, half, third].map((v) => { const x = xOf(v); return `<line class="tk" x1="${x.toFixed(1)}" y1="${arc(x).y.toFixed(1)}" x2="${x.toFixed(1)}" y2="170"/>`; }).join('');
  const hm = (v) => { const m = Math.round(v / 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const pts = [['m1', pname(5), mg, ''], ['m2', pname(6), is, ''], ['m3', t('night.mid'), half, ''], ['m4', t('night.third'), third, 'gold'], ['m5', pname(1), fj, 'next']];
  const marks = pts.map(([c, n, v, k], i) => `<div class="mark ${c} ${k}" style="left:${(xOf(v) / 10).toFixed(2)}%;transform:translateX(${i === 0 ? '-20%' : i === 4 ? '-70%' : '-50%'})"><span>${n.toUpperCase()}</span><b>${hm(v)}</b></div>`).join('');
  box.innerHTML = `<svg aria-hidden="true" viewBox="0 0 1000 200" preserveAspectRatio="none"><path class="arcbg" d="M${x0.toFixed(1)} 170 Q${mid.toFixed(1)} -110 ${x1.toFixed(1)} 170"/>${done}<line class="hz" x1="0" y1="170" x2="1000" y2="170"/>${ticks}</svg>`
    + `<span class="ico now moon" style="left:${(nowX / 10).toFixed(2)}%;top:${(arc(nowX).y - 36).toFixed(0)}px;width:72px;height:72px">${MOON}</span>` + marks;
  box.setAttribute('aria-label', t('aria.night', { m: hm(mg), i: hm(is), h: hm(half), l: hm(third), f: hm(fj) }));
}
function drawSun(now) {
  const T = state.times, box = $('#sunchart');
  if (!T) { box.innerHTML = ''; return; }
  const s = now ?? zoned(city.z).s, rise = sec(T[2]), set = sec(T[5]);
  // after Maghrib, and before Fajr, the chart becomes the night: Maghrib to the next Fajr
  const late = s >= set && state.tmrw, early = s < sec(T[1]) && state.yday, night = !!(late || early);
  $('#sunbox').classList.toggle('night', night);
  $('#sunh').textContent = t(night ? 'night.title' : 'sun.title');
  if (late) drawNight(box, s, set, sec(T[6]), sec(state.tmrw[1]) + 86400);
  else if (early) drawNight(box, s + 86400, sec(state.yday[5]), sec(state.yday[6]), sec(T[1]) + 86400);
  if (night) { drawFacts(T, s, rise, set); return; }
  const xOf = (v) => ((v / 60 - 240) / 960) * 1000, x0 = xOf(rise), x1 = xOf(set), mid = (x0 + x1) / 2;
  const arc = (x) => { const u = Math.min(1, Math.max(0, (x - x0) / (x1 - x0))); return { u, y: 170 - 4 * u * (1 - u) * 140 }; };
  const up = s > rise && s < set, nowX = Math.min(x1, Math.max(x0, xOf(s))), { u } = arc(nowX);
  // the part of the arc the sun has already travelled (the quadratic split at u)
  const qx = x0 + u * (mid - x0), qy = 170 + u * (-110 - 170);
  const done = s > rise ? `<path class="arcdone" d="M${x0.toFixed(1)} 170 Q${qx.toFixed(1)} ${qy.toFixed(1)} ${nowX.toFixed(1)} ${arc(nowX).y.toFixed(1)}"/>` : '';
  const ticks = [3, 4].map((i) => { const x = xOf(sec(T[i])); return `<line class="tk" x1="${x.toFixed(1)}" y1="${arc(x).y.toFixed(1)}" x2="${x.toFixed(1)}" y2="170"/>`; }).join('');
  const icon = (x, y, size, svg, cls = '') => `<span class="ico ${cls}" style="left:${(x / 10).toFixed(2)}%;top:${(y - size / 2).toFixed(0)}px;width:${size}px;height:${size}px">${svg}</span>`;
  const nxt = state.nextTomorrow ? -1 : state.next;
  const marks = PRAYER_IDX.map((i) => `<div class="mark m${i}${i === nxt ? ' next' : ''}" style="left:${(xOf(sec(T[i])) / 10).toFixed(2)}%;transform:translateX(${SHIFT[i] || '-50%'})"><span>${pname(i).toUpperCase()}</span><b>${T[i]}</b></div>`).join('');
  box.innerHTML = `<svg aria-hidden="true" viewBox="0 0 1000 200" preserveAspectRatio="none"><path class="arcbg" d="M${x0.toFixed(1)} 170 Q${mid.toFixed(1)} -110 ${x1.toFixed(1)} 170"/>${done}<line class="hz" x1="0" y1="170" x2="1000" y2="170"/>${ticks}</svg>`
    + icon(x0, 170, 56, HALF_SUN('var(--gold)')) + icon(x1, 170, 56, HALF_SUN('var(--persimmon)'))
    + (up ? icon(nowX, arc(nowX).y, 72, FULL_SUN, 'now') : '') + marks;
  box.setAttribute('aria-label', t('aria.sun', { r: T[2], s: T[5] }));
  drawFacts(T, s, rise, set);
}
function drawFacts(T, s, rise, set) {
  const day = set - rise;
  $('#daylen').textContent = t('dur.hm', { h: Math.floor(day / 3600), m: Math.round((day % 3600) / 60) });
  $('#dayspan').textContent = t('sun.span', { r: T[2], s: T[5] });
  if (s < set) { $('#setlabel').textContent = t('sun.setsin'); $('#setin').textContent = human(set - s); }
  else { $('#setlabel').textContent = t('sun.risesin'); $('#setin').textContent = state.tmrw ? human(sec(state.tmrw[2]) + 86400 - s) : '--'; }
}

/* qibla: great-circle bearing from the city to the Kaaba, computed on the device */
const KAABA = [21.4225, 39.8262];
function drawQibla() {
  if (city.lat == null) { $('.qibla').hidden = true; return; }
  $('.qibla').hidden = false;
  const R = Math.PI / 180, [la1, lo1] = [city.lat * R, city.lon * R], [la2, lo2] = [KAABA[0] * R, KAABA[1] * R];
  const y = Math.sin(lo2 - lo1) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  const deg = (Math.atan2(y, x) / R + 360) % 360;
  const a = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dir = t('dirs').split(',')[Math.round(deg / 22.5) % 16];
  $('#qdeg').textContent = `${Math.round(deg)}°`;
  $('#qdist').textContent = t('qibla.note', { d: dir, km: Math.round(km).toLocaleString(LOC()) });
  $('#needle').style.transform = `rotate(${deg.toFixed(1)}deg)`;
  $('#compass').setAttribute('aria-label', t('aria.qibla', { n: Math.round(deg), d: dir }));
}

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
  // one block per province (not newspaper columns) so headings can stick and the province nav can jump
  const provs = [...new Set(list.map((c) => c.p))];
  let i = 0;
  const html = provs.map((p, k) => `<section class="pgrp" id="pv${k}" aria-labelledby="pvh${k}"><h2 class="grp" id="pvh${k}">${esc(p)}</h2><div class="pcities">`
    + list.filter((c) => c.p === p).map((c) => {
      const me = c.id === city.id;
      // searching covers every zone, so each result names its own
      return `<button class="city" style="--i:${Math.min(i++, 12)}" aria-current="${me}" data-id="${c.id}"><span>${esc(c.n)}</span><small>${me ? t('city.active') : q ? c.z : ''}</small></button>`;
    }).join('') + '</div></section>').join('');
  $('#provs').innerHTML = provs.map((p, k) => `<button type="button" data-k="${k}"><i aria-hidden="true"></i><span>${esc(p)}</span><small>${list.filter((c) => c.p === p).length}</small></button>`).join('');
  spyLock = -1; // a new list: the old tapped stop means nothing
  if (list.length) { $('#cities').innerHTML = html; spyProv(true); return; }
  // no match: the archipelago map searching city to city, then the closest name as one tap
  const near = closest(q), map = $('#cities .nm-map');
  $('#cities').innerHTML = `<div class="nomatch"><div class="nm-band" aria-hidden="true"></div>`
    + `<p class="empty" role="status">${t('city.empty', { q: esc(raw) })}</p>${near ? `<button class="chip city" data-id="${near.id}">${esc(near.n)}</button>` : ''}</div>`;
  // keep the drawn map while typing so its animation doesn't restart on every letter
  if (map) { $('#cities .nm-band').append(map); markNear(map, near); } else drawMap($('#cities .nm-band'), near);
}
function markNear(map, near) {
  const hit = map.querySelector('.nm-hit'), ret = map.querySelector('.nm-ret');
  hit.style.display = near ? '' : 'none';
  if (!near) return;
  const [x, y] = mapXY(near);
  hit.setAttribute('cx', x); hit.setAttribute('cy', y);
  ret.style.setProperty('--rx', `${x}px`); ret.style.setProperty('--ry', `${y}px`);
}
/* the outline is a static file (cached by the service worker); dots and the target come from CITIES */
let MAP = null;
const HOPS = ['0119', '2013', '2622', '3110', '3329']; // Banda Aceh, Pontianak, Makassar, Ambon, Jayapura: west to east
const mapXY = (c) => [+((c.lon - 94.5) * 20).toFixed(1), +((7.5 - c.lat) * 20).toFixed(1)]; // same projection as indonesia.svg
async function drawMap(band, near) {
  MAP ??= fetch('assets/senja/indonesia.svg').then((r) => (r.ok ? r.text() : Promise.reject())).catch(() => (MAP = null, ''));
  const svg = await MAP;
  if (!svg || !band.isConnected) return;
  const stops = HOPS.map((id) => CITIES.find((c) => c.id === id)).filter(Boolean);
  const rest = mapXY(stops[2] || CITIES[0]); // where the target sits when motion is reduced; markNear moves it to the suggestion
  const dots = CITIES.map((c) => { const [x, y] = mapXY(c); return `<circle cx="${x}" cy="${y}" r="2"/>`; }).join('');
  const hit = '<circle class="nm-hit" r="7"/>';
  const labs = stops.map((c, i) => {
    const [x, y] = mapXY(c), end = x > 800;
    return `<text class="nm-lab" x="${end ? x - 14 : x + 14}" y="${y - 12}" text-anchor="${end ? 'end' : 'start'}" style="animation-delay:${2 + i * 3}s">${esc(c.n.replace(/^Kota\s+/, '').toUpperCase())}</text>`;
  }).join('');
  const vars = stops.map((c, i) => { const [x, y] = mapXY(c); return `--x${i}:${x}px;--y${i}:${y}px`; }).join(';');
  const ret = `<g class="nm-ret" style="${vars};--rx:${rest[0]}px;--ry:${rest[1]}px"><line x1="-5000" y1="0" x2="5000" y2="0"/><line x1="0" y1="-5000" x2="0" y2="5000"/><circle r="14"/><circle r="30" stroke-opacity=".6"/><circle r="52" stroke-opacity=".3"/><circle class="ping" r="14"/><circle class="pt" r="3.5"/></g>`;
  band.innerHTML = svg.replace('</svg>', `<g class="nm-dots">${dots}</g>${hit}${ret}${labs}</svg>`);
  markNear(band.querySelector('.nm-map'), near);
}
/* the city whose short name is fewest edits from the query ("makasar" → Kota Makassar) */
function closest(q) {
  if (q.length < 3) return null;
  const dist = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  };
  let best = null, bd = Infinity;
  for (const c of CITIES) {
    const d = dist(q, norm(c.n.replace(/^(Kota|Kab\.)\s+/, '')));
    if (d < bd || (d === bd && /^Kota/.test(c.n))) { bd = d; best = c; }
  }
  return bd <= Math.max(2, Math.floor(q.length / 3)) ? best : null;
}
function setZone(z) { zoneFilter = z; $$('#zones button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.z === z)); }
function renderLoc(animate) {
  $('#locname').textContent = city.n;
  $('#loczone').textContent = city.z;
  if (animate) { restart($('#locname'), 'swap'); restart($('#loczone'), 'swap'); }
  $('#locbtn').setAttribute('aria-label', t('aria.loc', { c: shortName(city.n), z: city.z }));
  $('#mloc').textContent = `${city.n} · ${city.z}`;
  $('#curcity').textContent = t('city.current', { c: city.n, p: city.p, z: city.z });
  // the city page's own text only fits while its city and language are shown
  const seo = $('#seo');
  if (seo) seo.hidden = city.id !== PAGE_CITY || LANG !== PAGE_LANG;
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
    toast(c.n, { label: t('undo'), fn: () => { applyCity(prev.c, { save: !prev.est }); estimated = prev.est; renderLoc(true); if (!prev.est) store.set('city', prev.c.id); } }, t('k.city'));
  }, RM ? 0 : 380);
}
$('#q').addEventListener('input', drawCities);
$('#qclear').addEventListener('click', () => { $('#q').value = ''; drawCities(); $('#q').focus(); });
$('#zones').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setZone(b.dataset.z); $('#q').value = ''; drawCities(); if ($('#cities').getBoundingClientRect().top < pinOffset()) jumpTo($('#cities')); buzz(6); });
/* the pinned bar (phone, tablet) or the desktop top rail covers this much of the viewport */
const pinOffset = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--railh')) || 0) + (DESK.matches ? 0 : $('#cpin').offsetHeight);
function jumpTo(el) { window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - pinOffset(), behavior: RM ? 'auto' : 'smooth' }); }
/* a tapped stop stays chosen until the user scrolls themselves: the last provinces can't reach the top
   of the page, and the smooth scroll would otherwise light up every stop it passes */
let spyLock = -1;
$('#provs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; spyLock = +b.dataset.k; spyProv(true); jumpTo($('#pv' + b.dataset.k)); buzz(6); });
['wheel', 'touchstart', 'keydown'].forEach((ev) => addEventListener(ev, (e) => { if (!e.target.closest?.('#provs')) spyLock = -1; }, { passive: true }));
/* highlight the province under the pinned bar, and keep its pill in view on the sideways strip */
let spyK = -1;
function spyProv(reset) {
  if (reset) spyK = -1;
  if (!$('#city').classList.contains('on')) return;
  const off = pinOffset() + 60, secs = $$('#cities .pgrp');
  let k = 0;
  if (spyLock >= 0 && spyLock < secs.length) k = spyLock;
  else secs.forEach((el, j) => { if (el.getBoundingClientRect().top <= off) k = j; });
  if (k === spyK || !secs.length) return;
  spyK = k;
  const nav = $('#provs');
  // a route: stops behind you are filled, the one you're in is the diamond, the rest wait ahead
  $$('#provs button').forEach((b) => { const j = +b.dataset.k; b.setAttribute('aria-current', j === k); b.classList.toggle('done', j < k); });
  const b = nav.children[k];
  if (b && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: b.offsetLeft - 16, behavior: RM ? 'auto' : 'smooth' });
}
let spyRaf = 0;
addEventListener('scroll', () => { if (!spyRaf) spyRaf = requestAnimationFrame(() => { spyRaf = 0; spyProv(); }); }, { passive: true });
const pinRO = new ResizeObserver(() => { const r = document.documentElement.style; r.setProperty('--pinh', $('#cpin').offsetHeight + 'px'); r.setProperty('--sideh', $('.cside').offsetHeight + 'px'); });
pinRO.observe($('#cpin')); pinRO.observe($('.cside'));
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
  // after a failure the button says what to do next: "Try again" (persimmon), or plain outline when access is off
  const done = (msg, mode = '') => {
    gpsBusy = false; g.removeAttribute('aria-busy'); const sp = g.querySelector('.spin'); if (sp) sp.remove();
    g.dataset.state = mode;
    icon.style.display = ''; $('#gpslabel').textContent = t(mode === 'retry' ? 'gps.retry' : 'gps.btn'); gpsMsg(msg);
  };
  if (!('geolocation' in navigator)) return done(t('gps.unavail'));
  gpsBusy = true; g.setAttribute('aria-busy', 'true'); icon.style.display = 'none';
  g.insertAdjacentHTML('afterbegin', '<i class="spin" aria-hidden="true"></i>');
  $('#gpslabel').textContent = t('gps.busy'); gpsMsg(t('gps.busy'));
  navigator.geolocation.getCurrentPosition((pos) => {
    const c = nearest(pos.coords.latitude, pos.coords.longitude);
    if (!c) return done(t('gps.unavail'));
    done(t('gps.found', { c: shortName(c.n) })); buzz(10); pickCity(c);
  }, (err) => done(t(err.code === 1 ? 'gps.denied' : err.code === 3 ? 'gps.timeout' : 'gps.unavail'), err.code === 1 ? 'off' : 'retry'),
  { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
});


/* ---------- month ---------- */
let mView = null, mData = null;
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
  grid.innerHTML = Array.from({ length: 7 }, (_, i) => `<span class="wd" aria-hidden="true">${wd.format(utcNoon({ y: 2024, m: 1, d: i + 1 })).replace('.', '')}</span>`).join('')
    + '<span></span>'.repeat(lead)
    + Array.from({ length: n }, (_, i) => {
      const d = i + 1, h = hijriDay({ y, m, d }), bidh = h >= 13 && h <= 15;
      const cls = [here && d === z.d ? 'today' : here && d < z.d || y * 12 + m < z.y * 12 + z.m ? 'past' : '', bidh ? 'bidh' : ''].join(' ');
      return `<button type="button" class="cday ${cls}" style="animation-delay:${i * 8}ms" data-d="${d}" aria-pressed="${d === mView.d}" aria-label="${full.format(utcNoon({ y, m, d }))}${bidh ? ', ' + t('bidh') : ''}">${d}<small aria-hidden="true">${h || ''}</small></button>`;
    }).join('');
  drawDay(); drawLight(data, y, m, n, here ? z.d : 0);
  $('#mlegend').innerHTML = `<span class="lg-b">${t('bidh.legend', { m: hijriMonth({ y, m, d: 15 }) })}</span><span class="lg-s">${t('sunnah')}</span>`;
  // the gold grid redraws, then the dates slide in from the side you moved toward
  if (dir && !RM) {
    restart($('.mcal'), 'drawing');
    grid.className = 'cgrid'; void grid.offsetWidth; grid.className = 'cgrid ' + (dir > 0 ? 'from-right' : 'from-left');
  }
}
/* Hijri day and month by the Umm al-Qura calendar (Kemenag's can differ by a day, as the footnote says) */
const hijriDay = (dt) => { try { return +dateFmt({ day: 'numeric' }, 'islamic-umalqura').format(utcNoon(dt)).replace(/\D/g, ''); } catch (e) { return 0; } };
const hijriMonth = (dt) => { try { return dateFmt({ month: 'long' }, 'islamic-umalqura').format(utcNoon(dt)); } catch (e) { return ''; } };

/* month in light: one small chart per prayer, how its time drifts across the month, today marked */
function drawLight(data, y, m, n, today) {
  const box = $('#mlight');
  if (!data) { box.innerHTML = ''; return; }
  box.innerHTML = PRAYER_IDX.map((k) => {
    const v = Array.from({ length: n }, (_, i) => { const T = data.days[doy(y, m, i + 1)]; return T ? sec(T[k]) / 60 : null; });
    const ok = v.filter((x) => x != null);
    if (!ok.length) return '';
    const lo = Math.min(...ok), hi = Math.max(...ok), span = Math.max(hi - lo, 4), pad = (span - (hi - lo)) / 2;
    const X = (i) => (n > 1 ? (i / (n - 1)) * 100 : 50), Y = (x) => 36 - ((x - lo + pad) / span) * 32;
    const d = v.map((x, i) => (x == null ? '' : `${i && v[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(x).toFixed(2)}`)).join('');
    const grid = [7, 14, 21, 28].filter((g) => g < n).map((g) => `<line x1="${X(g - 1).toFixed(2)}" y1="0" x2="${X(g - 1).toFixed(2)}" y2="40"/>`).join('');
    const first = ok[0], last = ok[ok.length - 1], diff = Math.round(last - first);
    const hm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.round(x % 60)).padStart(2, '0')}`;
    const dot = today && v[today - 1] != null ? `<i class="ldot" style="left:${X(today - 1).toFixed(2)}%;top:${(Y(v[today - 1]) / 40 * 100).toFixed(1)}%"></i>` : '';
    return `<li><p class="lh"><b>${pname(k)}</b><span>${hm(first)} → ${hm(last)}</span></p>`
      + `<div class="lchart" role="img" aria-label="${pname(k)}: ${hm(first)} → ${hm(last)}"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><g class="lg">${grid}<line x1="0" y1="38" x2="100" y2="38"/></g><path class="lp" d="${d}" pathLength="1"/></svg>${dot}</div>`
      + `<p class="ld">${diff ? t(diff > 0 ? 'light.later' : 'light.earlier', { n: Math.abs(diff) }) : t('light.same')}</p></li>`;
  }).join('');
  if (!RM) restart($('.mlight'), 'drawing');
}

/* five skies: the five paintings with the chosen day's times; hover or focus shows the line drawing */
function drawSkies(T, label) {
  $('#msh').textContent = t('skies.title', { d: label });
  $('#mskies').innerHTML = T ? PRAYER_IDX.map((k) => `<li><div class="th" tabindex="0" data-k="${k}" aria-label="${t('five.show', { n: pname(k) })}"><img class="thp" src="assets/senja/${ART[k]}.webp" alt="" loading="lazy"><img class="thk" src="assets/senja/${ART[k]}-lines.webp" alt="" loading="lazy"></div><span class="thl">${pname(k)} <span class="tht">${T[k]}</span></span></li>`).join('') : '';
}

function drawDay() {
  const { y, m, d } = mView, box = $('#mday'), z = zoned(city.z);
  if (!mData) { box.innerHTML = `<p class="state">${mData === undefined ? t('offlinenodata') : t('nodata', { y })}</p>`; drawSkies(null, ''); return; }
  const T = mData.days[doy(y, m, d)], today = z.y === y && z.m === m && z.d === d;
  drawSkies(T, today ? t('month.today') : dateFmt({ day: 'numeric', month: 'long' }).format(utcNoon({ y, m, d })));
  box.innerHTML = `<h2>${dateFmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(utcNoon({ y, m, d }))}${today ? ' · ' + t('month.today') : ''}</h2>`
    + (T ? `<p class="extra">${extraLine(T)}</p><ol class="steps">${stepsHtml(T)}</ol>` : `<p class="state">${t('nodata', { y })}</p>`)
    + `<p class="foot">${t('foot')}</p>`;
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
const DESK = matchMedia('(min-width: 1024px)');
// desktop: city, language and theme live in the top bar, as in the design; on phones they sit on the painting
const placeControls = () => (DESK.matches ? $('.rail') : $('#sky')).insertBefore($('.hdr-top'), DESK.matches ? null : $('#sky .plate'));
placeControls();
DESK.addEventListener('change', placeControls);
// each tab has its own address (#monthly, #city) so a refresh or the back button keeps your place
const HASH = { home: '', month: '#monthly', city: '#city' };
const fromHash = () => Object.keys(HASH).find((k) => HASH[k] && HASH[k] === location.hash) || 'home';
function go(id, { push = true } = {}) {
  if (id === cur) return;
  if (push && location.hash !== HASH[id]) history.pushState(null, '', HASH[id] || location.pathname + location.search);
  const dir = ORDER.indexOf(id) > ORDER.indexOf(cur) ? 'from-right' : 'from-left';
  cur = id;
  $$('.screen').forEach((s) => { s.classList.remove('on', 'from-right', 'from-left'); if (s.id === id) s.classList.add('on', dir); });
  $$('.stop').forEach((x) => x.setAttribute('aria-current', x.dataset.go === id ? 'page' : 'false'));
  window.scrollTo(0, 0); $('#mini').classList.remove('show');
  if (id === 'city') { setZone(city.z); $('#q').value = ''; gpsMsg(); drawCities(); const me = $('#cities .city[aria-current="true"]'); if (me) me.scrollIntoView({ block: 'center' }); window.scrollTo(0, 0); }
  if (id === 'home' && state.times) drawSun();
  if (id === 'month') { const z = zoned(city.z); mView = { y: z.y, m: z.m }; drawMonth(); if (!RM) restart($('.mcal'), 'drawing'); }
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
addEventListener('popstate', () => go(fromHash(), { push: false }));
new IntersectionObserver(([e]) => $('#mini').classList.toggle('show', cur === 'home' && !e.isIntersecting), { rootMargin: '-120px 0px 0px 0px' }).observe($('#sky'));

/* ---------- theme ---------- */
const isDark = () => { const r = document.documentElement; return r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const themeColor = () => $('#themecolor').setAttribute('content', isDark() ? '#1D1F21' : '#F2E6C9');
$('#theme').addEventListener('click', (e) => {
  const r = document.documentElement, dark = isDark();
  const apply = () => { r.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', r.dataset.theme); themeColor(); };
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
  $('#langcode').textContent = LANG === 'id' ? 'EN' : 'ID'; // shows the language a tap switches to
  $('#lang').setAttribute('aria-label', t('aria.lang'));
  $('#hnext').textContent = t('nextprayer');
  $('#hin').textContent = t('in');
  $('#alllink').setAttribute('href', SECTIONS[LANG]);
  if (!$('#gps').hasAttribute('aria-busy')) $('#gpslabel').textContent = t('gps.btn');
  gpsMsg();
  net();
  if (city) { renderLoc(false); drawCities(); if (state.today) renderStatic(); state.next = -1; tick(true); drawMonth(); }
}
$('#lang').addEventListener('click', () => { LANG = LANG === 'id' ? 'en' : 'id'; store.set('lang', LANG); applyLang(); buzz(6); toast(t('t.lang'), null, t('k.lang')); });


/* ---------- connection ---------- */
function net() { const n = $('#net'); if (navigator.onLine) { n.classList.remove('show'); return; } n.textContent = t('offline'); n.classList.add('show'); }
addEventListener('online', () => { net(); toast(t('t.online'), null, t('k.net')); if (state.status === 'offline') { yearCache.clear(); loadToday(); } });
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
        if (!navigator.serviceWorker.controller) toast(t('t.offline'), null, t('k.saved'));
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
themeColor();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeColor);
applyLang();
drawList();
try {
  const res = await fetch('data/cities.json');
  if (!res.ok) throw new Error(res.status);
  CITIES = await res.json();
} catch (e) { CITIES = []; }
if (CITIES.length) {
  // arriving on a city page with nothing saved yet: that city becomes the default
  const first = initialCity();
  applyCity(first, { save: first.id === PAGE_CITY && !store.get('city'), animate: false });
  go(fromHash(), { push: false });
} else {
  state.status = 'offline'; $('#locname').textContent = '—'; drawCities();
  $('#list').innerHTML = `<li class="state">${t('city.loadfail')}</li>`;
}
setInterval(() => tick(), 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
addEventListener('resize', () => { if (state.times) drawSun(); stickTops(); });
