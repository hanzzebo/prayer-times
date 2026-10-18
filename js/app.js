import { I18N } from './i18n.js';

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
const sec = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60; };
const fmtDur = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const dateFmt = (opts, cal) => new Intl.DateTimeFormat(LOC() + (cal ? '-u-ca-' + cal : ''), { timeZone: 'UTC', ...opts });

/* ---------- prayers ---------- */
const KEYS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
const PRAYERS = [1, 3, 4, 5, 6]; // indices that count as "next prayer"
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
let toastTimer, toastFn;
function toast(msg, action) {
  $('#tmsg').textContent = msg;
  toastFn = action && action.fn;
  $('#tact').textContent = action ? action.label : '';
  $('#tact').style.display = action ? '' : 'none';
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  if (!action || !action.sticky) toastTimer = setTimeout(() => $('#toast').classList.remove('show'), action ? 4500 : 2400);
}
$('#tact').addEventListener('click', () => { if (toastFn) toastFn(); $('#toast').classList.remove('show'); });

/* ---------- today state ---------- */
const state = { today: null, times: null, tmrw: null, yday: null, next: -1, selOffset: 0, phase: '', status: 'loading' };
const SKY_OVERRIDE = new URLSearchParams(location.search).get('sky'); // ?sky=dawn|day|dusk|night to preview

async function loadToday() {
  const z = zoned(city.z);
  state.today = { y: z.y, m: z.m, d: z.d };
  const [a, b, c] = await Promise.all([timesFor(city.id, state.today), timesFor(city.id, shift(z.y, z.m, z.d, 1)), timesFor(city.id, shift(z.y, z.m, z.d, -1))]);
  state.times = a || null; state.tmrw = b || null; state.yday = c || null;
  state.status = a ? 'ok' : a === undefined ? 'offline' : 'nodata';
  state.next = -1; state.phase = '';
  renderStatic(); tick(true);
}

function computeNext(s) {
  const T = state.times;
  for (const i of PRAYERS) if (sec(T[i]) > s) {
    const prevIdx = PRAYERS[PRAYERS.indexOf(i) - 1];
    const prev = prevIdx != null ? sec(T[prevIdx]) : state.yday ? sec(state.yday[6]) - 86400 : sec(T[i]) - 3600;
    return { i, target: sec(T[i]), prev, tomorrow: false };
  }
  const nt = state.tmrw ? sec(state.tmrw[1]) + 86400 : null;
  return { i: 1, target: nt, prev: sec(T[6]), tomorrow: true };
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

let lastCount = '';
function tick(force) {
  if (!city) return;
  const z = zoned(city.z);
  if (state.today && (z.d !== state.today.d || z.m !== state.today.m)) return loadToday(); // midnight rollover
  if (state.status !== 'ok') return;
  const T = state.times, s = z.s;

  const ph = SKY_OVERRIDE && /^(dawn|day|dusk|night)$/.test(SKY_OVERRIDE) ? SKY_OVERRIDE : phaseOf(s);
  if (ph !== state.phase) { state.phase = ph; $('#sky').className = 'hdr sky-' + ph; }
  const rise = sec(T[2]), set = sec(T[5]), up = ph !== 'night' && s >= rise - 1800 && s <= set + 1800;
  $('#sun').style.opacity = up ? 1 : 0; $('#sunpath').style.opacity = up ? 1 : 0;
  moveSun(Math.min(1, Math.max(0, (s - rise) / (set - rise))));

  const n = computeNext(s);
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
<span class="tm">${T[i]}</span>${nxt === i ? '<span class="bar" aria-hidden="true"></span>' : ''}</div>`;
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
  const list = CITIES.filter((c) => (q ? norm(c.n).includes(q) || norm(c.p).includes(q) : c.z === zoneFilter));
  $('#cities').innerHTML = list.length
    ? list.map((c, i) => `<button class="city" style="--i:${Math.min(i, 12)}" aria-current="${c.id === city.id}" data-id="${c.id}"><span>${esc(c.n)}</span><small>${c.id === city.id && !estimated ? t('city.active') : esc(c.p) + (q ? ' · ' + c.z : '')}</small></button>`).join('')
    : `<p class="empty">${t('city.empty', { q: esc(raw) })}</p>`;
}
function setZone(z) { zoneFilter = z; $$('#zones button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.z === z)); }
function renderLoc(animate) {
  $('#locname').textContent = shortName(city.n);
  $('#loczone').textContent = city.z;
  if (animate) { restart($('#locname'), 'swap'); restart($('#loczone'), 'swap'); }
  $('#locbtn').setAttribute('aria-label', t('aria.loc', { c: shortName(city.n), z: city.z }));
  $('#mloc').textContent = `${shortName(city.n)} · ${city.z}`;
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
    applyCity(c); go('home');
    toast(t('t.city', { c: shortName(c.n) }), { label: t('undo'), fn: () => { applyCity(prev.c, { save: !prev.est }); estimated = prev.est; renderLoc(true); if (!prev.est) store.set('city', prev.c.id); } });
  }, RM ? 0 : 380);
}
$('#q').addEventListener('input', drawCities);
$('#qclear').addEventListener('click', () => { $('#q').value = ''; drawCities(); $('#q').focus(); });
$('#zones').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setZone(b.dataset.z); $('#q').value = ''; drawCities(); buzz(6); });
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
$('#gps').addEventListener('click', () => {
  if (gpsBusy) return;
  const g = $('#gps'), icon = g.querySelector('svg');
  const done = (msg) => {
    gpsBusy = false; g.removeAttribute('aria-busy'); const sp = g.querySelector('.spin'); if (sp) sp.remove();
    icon.style.display = ''; $('#gpslabel').textContent = t('gps.btn'); $('#gpsmsg').textContent = msg;
  };
  if (!('geolocation' in navigator)) return done(t('gps.unavail'));
  gpsBusy = true; g.setAttribute('aria-busy', 'true'); icon.style.display = 'none';
  g.insertAdjacentHTML('afterbegin', '<i class="spin" aria-hidden="true"></i>');
  $('#gpslabel').textContent = t('gps.busy'); $('#gpsmsg').textContent = '';
  navigator.geolocation.getCurrentPosition((pos) => {
    const c = nearest(pos.coords.latitude, pos.coords.longitude);
    if (!c) return done(t('gps.unavail'));
    done(t('gps.found', { c: shortName(c.n) })); buzz(10); pickCity(c);
  }, (err) => done(t(err.code === 1 ? 'gps.denied' : err.code === 3 ? 'gps.timeout' : 'gps.unavail')),
  { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
});

/* ---------- month ---------- */
let mView = null;
async function drawMonth(dir) {
  if (!city) return;
  if (!mView) { const z = zoned(city.z); mView = { y: z.y, m: z.m }; }
  const { y, m } = mView;
  $('#mname').textContent = dateFmt({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 15)));
  if (dir) restart($('#mname'), 'swap');
  const tb = $('#days'), data = await loadYear(city.id, y);
  if (mView.y !== y || mView.m !== m) return;
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate(), z = zoned(city.z);
  if (!data) {
    tb.innerHTML = `<tr><td colspan="7" class="state">${data === undefined ? t('offlinenodata') : t('nodata', { y })}</td></tr>`;
  } else {
    tb.innerHTML = Array.from({ length: n }, (_, i) => {
      const T = data.days[doy(y, m, i + 1)];
      const today = z.y === y && z.m === m && z.d === i + 1;
      return `<tr class="${today ? 'today' : ''}"><td>${i + 1}</td>${[0, 1, 3, 4, 5, 6].map((k) => `<td>${T ? T[k] : '--:--'}</td>`).join('')}</tr>`;
    }).join('');
  }
  if (dir && !RM) { tb.className = ''; void tb.offsetWidth; tb.className = dir > 0 ? 'from-right' : 'from-left'; }
}
$('#prev').onclick = () => { mView.m--; if (mView.m < 1) { mView.m = 12; mView.y--; } drawMonth(-1); };
$('#next').onclick = () => { mView.m++; if (mView.m > 12) { mView.m = 1; mView.y++; } drawMonth(1); };

/* ---------- navigation ---------- */
const ORDER = ['home', 'month', 'city'];
let cur = 'home';
function go(id) {
  if (id === cur) return;
  const dir = ORDER.indexOf(id) > ORDER.indexOf(cur) ? 'from-right' : 'from-left';
  cur = id;
  $$('.screen').forEach((s) => { s.classList.remove('on', 'from-right', 'from-left'); if (s.id === id) s.classList.add('on', dir); });
  $$('.tab').forEach((x) => x.setAttribute('aria-selected', x.dataset.go === id));
  placeTab(); window.scrollTo(0, 0); $('#mini').classList.remove('show');
  if (id === 'home') requestAnimationFrame(placeWeek);
  if (id === 'city') { setZone(city.z); $('#q').value = ''; drawCities(); }
  if (id === 'month') { const z = zoned(city.z); mView = { y: z.y, m: z.m }; drawMonth().then(() => { const r = $('#days .today'); if (r) r.scrollIntoView({ block: 'center' }); }); }
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
  $('#gpsmsg').textContent = '';
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
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state !== 'installed') return;
        if (navigator.serviceWorker.controller) toast(t('t.update'), { label: t('reload'), sticky: true, fn: () => w.postMessage('skipWaiting') });
        else toast(t('t.offline'));
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
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
