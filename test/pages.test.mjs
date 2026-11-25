import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSite, slug, placeName } from '../scripts/build-pages.mjs';

const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const allCities = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'));
const BASE = 'https://example.github.io/prayer-times/';
const cities = [
  { id: '3273', n: 'Kota Bandung', p: 'Jawa Barat', z: 'WIB' },
  { id: '3204', n: 'Kab. Bandung', p: 'Jawa Barat', z: 'WIB' },
  { id: '9171', n: 'Kota Jayapura', p: 'Papua', z: 'WIT' },
];
const day = ['04:01', '04:11', '05:25', '11:40', '14:59', '17:52', '19:04'];
const daysOf = () => Array.from({ length: 366 }, () => day);
// 1 Nov 2026, 00:30 in Jakarta: still 31 Oct in UTC
const build = (over = {}) => buildSite({ shell, cities, base: BASE, now: new Date('2026-10-31T17:30:00Z'), daysOf, ...over });

test('every city gets its own slug', () => {
  assert.equal(new Set(allCities.map((c) => slug(c.n))).size, allCities.length);
  assert.equal(slug('Kab. Aceh Barat'), 'kab-aceh-barat');
  assert.equal(slug('Kota Bau-bau'), 'kota-bau-bau');
});

test('place names match how people search in each language', () => {
  assert.equal(placeName('Kab. Bandung', 'id'), 'Kabupaten Bandung');
  assert.equal(placeName('Kota Bandung', 'id'), 'Kota Bandung');
  assert.equal(placeName('Kota Bandung', 'en'), 'Bandung');
  assert.equal(placeName('Kab. Bandung', 'en'), 'Bandung Regency');
  assert.equal(placeName('Pulau Laut Kab. Natuna', 'en'), 'Pulau Laut, Natuna Regency');
});

test('city page opens the app on its city, pointed at the site root', () => {
  const html = build()['jadwal-sholat/kota-bandung/index.html'];
  assert.match(html, /<html lang="id" data-city="3273">/);
  assert.match(html, /<base href="..\/..\/">/);
  assert.match(html, /<title>Jadwal Sholat Kota Bandung Hari Ini, November 2026<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.github.io\/prayer-times\/jadwal-sholat\/kota-bandung\/">/);
  assert.match(html, /hreflang="en" href="https:\/\/example.github.io\/prayer-times\/en\/prayer-times\/kota-bandung\/"/);
  assert.match(html, /<a href="jadwal-sholat\/kab-bandung\/">Kabupaten Bandung<\/a>/);
  assert.match(html, /<a href="en\/prayer-times\/kota-bandung\/" hreflang="en">English<\/a>/);
  assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 30); // November, in the city's zone
  assert.match(html, /<script type="module" src="js\/app.js"><\/script>/);
  assert.doesNotMatch(html, /(href|src)="\//); // the site lives under /<repo>/, so no root-absolute paths
});

test('English pages use English names and sit one folder deeper', () => {
  const html = build()['en/prayer-times/kab-bandung/index.html'];
  assert.match(html, /<html lang="en" data-city="3204">/);
  assert.match(html, /<base href="..\/..\/..\/">/);
  assert.match(html, /<title>Bandung Regency Prayer Times Today, November 2026<\/title>/);
  assert.match(html, /<th scope="col">Fajr<\/th>/);
});

test('a city without that year published still gets a page, without the table', () => {
  const html = build({ daysOf: () => null })['jadwal-sholat/kota-jayapura/index.html'];
  assert.match(html, /<h1>Jadwal Sholat Kota Jayapura<\/h1>/);
  assert.doesNotMatch(html, /<table>/);
});

test('malformed times stop the build instead of reaching the page', () => {
  assert.throws(() => build({ daysOf: () => Array.from({ length: 366 }, () => ['<b>', ...day.slice(1)]) }), /bad times/);
});

test('sitemap lists home, both city lists and every city page in both languages', () => {
  const xml = build()['sitemap.xml'];
  assert.equal((xml.match(/<url>/g) || []).length, 1 + 2 + cities.length * 2);
  assert.match(xml, /<loc>https:\/\/example.github.io\/prayer-times\/<\/loc><lastmod>2026-11-01<\/lastmod>/);
});

test('home page gets canonical and preview tags, list pages drop the app script', () => {
  const files = build();
  assert.match(files['index.html'], /<link rel="canonical" href="https:\/\/example.github.io\/prayer-times\/">/);
  assert.match(files['jadwal-sholat/index.html'], /<h2 class="grp">Jawa Barat<\/h2>/);
  assert.doesNotMatch(files['jadwal-sholat/index.html'], /js\/app.js/);
});

test('SITE_URL must be absolute https with a trailing slash', () => {
  assert.throws(() => build({ base: 'http://example.com/' }), /SITE_URL/);
  assert.throws(() => build({ base: 'https://example.com/repo' }), /SITE_URL/);
});
