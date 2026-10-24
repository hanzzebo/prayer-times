#!/usr/bin/env node
// Downloads the official Kemenag prayer schedule (served by api.myquran.com) into static JSON
// so the app never calls an API at runtime and works fully offline.
//
//   data/cities.json          [{ id, n, p, z, lat, lon }]   name, province, WIB/WITA/WIT, coordinates
//   data/<year>/<id>.json     { id, year, days: [[imsak, subuh, terbit, dzuhur, ashar, maghrib, isya], ...] }
//                             days[0] is 1 January, one entry per day of the year
//
// Existing files are kept, so reruns only fetch what is missing.
// Env: YEARS="2026,2027"  API_BASE=...  GEOCODE_BASE=...  GEOCODE=0 (skip coordinates)  CONCURRENCY=2

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API = process.env.API_BASE || 'https://api.myquran.com/v2';
const GEO = process.env.GEOCODE_BASE || 'https://nominatim.openstreetmap.org';
const OUT = path.resolve(process.env.OUT_DIR || 'data');
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const PAUSE_MS = Number(process.env.PAUSE_MS || 300);
const UA = `jadwal-sholat-pwa (+https://github.com/${process.env.GITHUB_REPOSITORY || 'unknown/unknown'})`;
const KEYS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

const now = new Date();
const YEARS = process.env.YEARS
  ? process.env.YEARS.split(',').map(Number)
  : [now.getUTCFullYear(), ...(now.getUTCMonth() >= 10 ? [now.getUTCFullYear() + 1] : [])]; // add next year from November

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.access(p).then(() => true, () => false);

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** i);
    }
  }
}

// Province (daerah) to Indonesian time zone.
export function zoneOf(daerah) {
  const p = daerah.toUpperCase();
  if (/PAPUA|MALUKU/.test(p)) return 'WIT';
  if (/BALI|NUSA TENGGARA|SULAWESI|GORONTALO|KALIMANTAN (SELATAN|TIMUR|UTARA)/.test(p)) return 'WITA';
  if (/ACEH|SUMATERA|RIAU|JAMBI|BENGKULU|LAMPUNG|BANGKA|JAKARTA|JAWA|BANTEN|YOGYAKARTA|KALIMANTAN (BARAT|TENGAH)/.test(p)) return 'WIB';
  throw new Error(`unknown province: ${daerah}`); // fail loudly instead of guessing a zone
}

const UPPER = new Set(['dki', 'di', 'ntb', 'ntt']);
function titleCase(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
    .split(' ')
    .map((w, i) => (UPPER.has(w.replace(/\./g, '')) && (i === 0 || w.length <= 3)
      ? w.replace(/\./g, '').toUpperCase()
      : w.replace(/^([a-z])/, (c) => c.toUpperCase())))
    .join(' ')
    .replace(/^Kab\b\.?/, 'Kab.');
}

const doy = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5;
const daysIn = (y) => doy(y + 1, 1, 1);

async function fetchYear(id, year) {
  const days = new Array(daysIn(year)).fill(null);
  let daerah = '';
  for (let m = 1; m <= 12; m++) {
    const json = await getJSON(`${API}/sholat/jadwal/${id}/${year}/${String(m).padStart(2, '0')}`);
    const data = json && json.data;
    if (!json.status || !data || !Array.isArray(data.jadwal)) throw new Error(`bad response for ${id} ${year}-${m}`);
    daerah = data.daerah || daerah;
    for (const row of data.jadwal) {
      const [y, mm, dd] = String(row.date).split('-').map(Number);
      if (y !== year || mm !== m) continue;
      const times = KEYS.map((k) => row[k]);
      if (!times.every((t) => /^\d{2}:\d{2}$/.test(t))) throw new Error(`bad times for ${id} ${row.date}`);
      days[doy(y, mm, dd)] = times;
    }
    await sleep(PAUSE_MS);
  }
  const missing = days.findIndex((d) => !d);
  if (missing !== -1) throw new Error(`incomplete year ${year} for ${id} (day ${missing + 1} missing)`);
  return { days, daerah };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function geocode(city) {
  const kind = /^Kab\./.test(city.n) ? 'Kabupaten' : 'Kota';
  const base = city.n.replace(/^(Kab\.|Kota)\s+/, '');
  // second try: bare place name, e.g. "Pulau Laut" for "Pulau Laut Kab. Natuna"
  const bare = base.replace(/\s+Kab\.\s.*$/, '');
  for (const q of [`${kind} ${base}, ${city.p}, Indonesia`, `${bare}, ${city.p}, Indonesia`]) {
    const res = await getJSON(`${GEO}/search?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(q)}`, 2);
    if (Array.isArray(res) && res[0]) return [Number(Number(res[0].lat).toFixed(4)), Number(Number(res[0].lon).toFixed(4))];
    await sleep(1100); // Nominatim usage policy: max 1 request per second
  }
  return null;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const citiesPath = path.join(OUT, 'cities.json');
  const known = new Map((await exists(citiesPath) ? JSON.parse(await fs.readFile(citiesPath, 'utf8')) : []).map((c) => [c.id, c]));

  const list = await getJSON(`${API}/sholat/kota/semua`);
  if (!Array.isArray(list.data) || !list.data.length) throw new Error('city list is empty');
  console.log(`${list.data.length} cities, years ${YEARS.join(', ')}`);

  const failures = [];
  let fetched = 0;
  await pool(list.data, CONCURRENCY, async ({ id, lokasi }) => {
    if (!/^\d{1,6}$/.test(String(id))) { failures.push(`bad city id ${JSON.stringify(id)}`); console.warn(`  ! bad city id ${JSON.stringify(id)}`); return; } // ids end up in file paths and HTML
    const city = known.get(id) || { id, n: titleCase(lokasi), p: '', z: '' };
    city.n = titleCase(lokasi);
    for (const year of YEARS) {
      const file = path.join(OUT, String(year), `${id}.json`);
      if (await exists(file) && city.p) continue;
      try {
        const { days, daerah } = await fetchYear(id, year);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify({ id, year, days }));
        if (daerah) { city.p = titleCase(daerah); city.z = zoneOf(daerah); }
        fetched++;
        if (fetched % 25 === 0) console.log(`  ${fetched} city-years fetched`);
      } catch (err) {
        failures.push(err.message);
        console.warn(`  ! ${err.message}`);
      }
    }
    if (city.p) known.set(id, city);
  });

  if (process.env.GEOCODE !== '0') {
    const todo = [...known.values()].filter((c) => c.lat == null); // misses are retried each run (about 10 cities)
    if (todo.length) console.log(`geocoding ${todo.length} cities (1 request/second, OpenStreetMap Nominatim)`);
    for (const c of todo) {
      try {
        const ll = await geocode(c);
        if (ll) { [c.lat, c.lon] = ll; delete c.geoFailed; }
      } catch (err) { console.warn(`  ! geocode ${c.n}: ${err.message}`); }
      await sleep(1100); // Nominatim usage policy: max 1 request per second
    }
  }

  const ids = new Set(list.data.map((c) => c.id));
  const out = [...known.values()].filter((c) => ids.has(c.id) && c.z).sort((a, b) => a.n.localeCompare(b.n, 'id'));
  await fs.writeFile(citiesPath, JSON.stringify(out));
  const withCoords = out.filter((c) => c.lat != null).length;
  console.log(`done: ${out.length} cities (${withCoords} with coordinates), ${fetched} city-years fetched, ${failures.length} failures`);
  if (!out.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
