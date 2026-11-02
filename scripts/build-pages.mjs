#!/usr/bin/env node
// Builds the pages search engines index, into an assembled site folder (run at deploy, after copying the app):
//
//   jadwal-sholat/<slug>/index.html       the app opened on one city, plus that month's table as plain HTML (Indonesian)
//   en/prayer-times/<slug>/index.html     the same in English
//   jadwal-sholat/index.html, en/prayer-times/index.html   every city, grouped by province
//   sitemap.xml, and canonical/Open Graph tags on the home page
//
// City pages copy index.html and add <base href="../../"> so every relative path still points at the site root.
// Absolute URLs (canonical, hreflang, sitemap) need the public address, so SITE_URL is required.
//
//   SITE_URL=https://<user>.github.io/<repo>/ node scripts/build-pages.mjs [siteDir=_site]
// Env: BUILD_DATE (ISO date, for testing)

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { I18N } from '../js/i18n.js';

export const SECTIONS = { id: 'jadwal-sholat/', en: 'en/prayer-times/' };
const TZ = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' };
const KEYS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

const S = {
  id: {
    locale: 'id-ID', og: 'id_ID',
    title: (p, m) => `Jadwal Sholat ${p} Hari Ini, ${m}`,
    desc: (p, prov) => `Jadwal sholat ${p}, ${prov}: Imsak, Subuh, Dzuhur, Ashar, Maghrib dan Isya untuk hari ini dan sebulan penuh. Dari Kemenag RI. Bisa offline, tanpa pelacakan.`,
    h1: (p) => `Jadwal Sholat ${p}`,
    intro: (p, prov, z, m) => `Waktu sholat di ${p}, ${prov}, untuk ${m}. Semua jam dalam ${z}. Jadwal dari Kemenag RI.`,
    caption: (p, m) => `Jadwal sholat ${p}, ${m}`,
    date: 'Tanggal',
    others: (prov) => `Kota dan kabupaten lain di ${prov}`,
    all: 'Semua kota dan kabupaten', switchTo: 'English',
    listTitle: 'Jadwal Sholat Seluruh Indonesia, per Kota dan Kabupaten',
    listDesc: 'Jadwal sholat hari ini untuk semua kota dan kabupaten di Indonesia, dari Kemenag RI. Pilih daerah Anda.',
    listH1: 'Jadwal sholat seluruh Indonesia',
    listIntro: 'Pilih kota atau kabupaten untuk melihat jadwal sholat hari ini dan sebulan penuh. Jadwal dari Kemenag RI.',
    open: 'Buka aplikasi',
  },
  en: {
    locale: 'en-GB', og: 'en_US',
    title: (p, m) => `${p} Prayer Times Today, ${m}`,
    desc: (p, prov) => `Prayer times for ${p}, ${prov}, Indonesia: Fajr, Dhuhr, Asr, Maghrib and Isha for today and the whole month. From Kemenag RI, Indonesia's Ministry of Religious Affairs. Works offline, no tracking.`,
    h1: (p) => `${p} Prayer Times`,
    intro: (p, prov, z, m) => `Prayer times in ${p}, ${prov}, Indonesia, for ${m}. All times are in ${z}. Schedule from Kemenag RI, Indonesia's Ministry of Religious Affairs.`,
    caption: (p, m) => `${p} prayer times, ${m}`,
    date: 'Date',
    others: (prov) => `Other cities and regencies in ${prov}`,
    all: 'All cities and regencies', switchTo: 'Bahasa Indonesia',
    listTitle: 'Prayer Times in Indonesia, by City and Regency',
    listDesc: 'Today\'s prayer times for every city and regency in Indonesia, from Kemenag RI. Choose your area.',
    listH1: 'Prayer times in Indonesia',
    listIntro: 'Choose a city or regency to see today\'s prayer times and the whole month. Schedule from Kemenag RI, Indonesia\'s Ministry of Religious Affairs.',
    open: 'Open the app',
  },
};

const esc = (x) => String(x).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const HHMM = /^\d{2}:\d{2}$/;

/* "Kota Bau-bau" -> "kota-bau-bau", "Kab. Aceh Barat" -> "kab-aceh-barat" */
export const slug = (n) => n.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* the name people search for: "Kabupaten Bandung" in Indonesian, "Bandung Regency" in English */
export function placeName(n, lang) {
  if (lang === 'id') return n.replace(/\bKab\. /, 'Kabupaten ');
  if (n.startsWith('Kota ')) return n.slice(5);
  if (n.startsWith('Kab. ')) return `${n.slice(5)} Regency`;
  return `${n.replace(' Kab. ', ', ')} Regency`; // "Pulau Laut Kab. Natuna" -> "Pulau Laut, Natuna Regency"
}

function zonedYM(zone, now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[zone], year: 'numeric', month: 'numeric' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month };
}
const monthLabel = (lang, y, m) => new Intl.DateTimeFormat(S[lang].locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 15)));

/* replace exactly one match, so a change to index.html can't silently produce broken pages */
function swap(html, find, make) {
  const n = typeof find === 'string' ? html.split(find).length - 1 : (html.match(new RegExp(find.source, 'g')) || []).length;
  if (n !== 1) throw new Error(`build-pages: expected one match for ${find}, found ${n}`);
  return html.replace(find, make);
}

function headTags(base, { lang, title, desc, url, alt }) {
  const hreflang = alt
    ? [`<link rel="alternate" hreflang="id" href="${esc(alt.id)}">`, `<link rel="alternate" hreflang="en" href="${esc(alt.en)}">`, `<link rel="alternate" hreflang="x-default" href="${esc(alt.id)}">`]
    : [];
  return [
    `<link rel="canonical" href="${esc(url)}">`, ...hreflang,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Jadwal Sholat">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:locale" content="${S[lang].og}">`,
    `<meta property="og:image" content="${esc(base)}icons/icon-512.png">`,
    '<meta name="twitter:card" content="summary">',
  ].join('\n');
}

/* the app shell re-pointed at the site root, with its own language, title and tags */
function page(shell, base, { lang, depth, city, title, desc, url, alt }) {
  let h = swap(shell, /<html lang="[a-z]+">/, () => `<html lang="${lang}"${city ? ` data-city="${esc(city)}"` : ''}>`);
  if (depth) h = swap(h, '<meta charset="utf-8">', () => `<meta charset="utf-8">\n<base href="${'../'.repeat(depth)}">`);
  h = swap(h, /<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  h = swap(h, /<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(desc)}">\n${headTags(base, { lang, title, desc, url, alt })}`);
  return h;
}

function monthTable(lang, c, y, m, days) {
  const s = S[lang], first = (Date.UTC(y, m - 1, 1) - Date.UTC(y, 0, 1)) / 864e5, n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wd = new Intl.DateTimeFormat(s.locale, { timeZone: 'UTC', weekday: 'short' });
  const rows = [];
  for (let d = 1; d <= n; d++) {
    const T = days[first + d - 1];
    if (!Array.isArray(T) || T.length !== 7 || !T.every((x) => HHMM.test(x))) throw new Error(`build-pages: bad times for ${c.id} ${y}-${m}-${d}`);
    rows.push(`<tr><th scope="row">${esc(wd.format(new Date(Date.UTC(y, m - 1, d))).replace('.', ''))} ${d}</th>${T.map((x) => `<td>${x}</td>`).join('')}</tr>`);
  }
  const head = KEYS.map((k) => `<th scope="col">${esc(I18N[lang]['pr.' + k])}</th>`).join('');
  return `<div class="tbl"><table><caption>${esc(s.caption(placeName(c.n, lang), monthLabel(lang, y, m)))}</caption>`
    + `<thead><tr><th scope="col">${s.date}</th>${head}</tr></thead><tbody>\n${rows.join('\n')}\n</tbody></table></div>`;
}

/* Builds every generated file. daysOf(id, year) returns that city's days array, or null if not published. */
export function buildSite({ shell, cities, base, now = new Date(), daysOf }) {
  if (!/^https:\/\/[^/]+\/(.+\/)?$/.test(base)) throw new Error(`build-pages: SITE_URL must be an https URL ending in /, got ${base}`);
  const slugs = new Map(cities.map((c) => [c.id, slug(c.n)]));
  if (new Set(slugs.values()).size !== cities.length) throw new Error('build-pages: two cities share a slug');
  const href = (lang, c) => `${SECTIONS[lang]}${slugs.get(c.id)}/`;
  const abs = (rel) => base + rel;
  const byProv = new Map();
  for (const c of [...cities].sort((a, b) => a.p.localeCompare(b.p, 'id') || a.n.localeCompare(b.n, 'id'))) {
    if (!byProv.has(c.p)) byProv.set(c.p, []);
    byProv.get(c.p).push(c);
  }
  const files = {};
  const sitemap = [];
  const ym = zonedYM('WIB', now), lastmod = `${ym.y}-${String(ym.m).padStart(2, '0')}-01`;
  const urlEntry = (loc, alt) => `<url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod>${alt
    ? `<xhtml:link rel="alternate" hreflang="id" href="${esc(alt.id)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(alt.en)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(alt.id)}"/>`
    : ''}</url>`;

  // home page: same app, now with absolute canonical and link-preview tags
  files['index.html'] = swap(shell, /<meta name="description" content="[^"]*">/, (tag) => {
    const title = shell.match(/<title>([^<]*)<\/title>/)[1], desc = tag.match(/content="([^"]*)"/)[1];
    return `${tag}\n${headTags(base, { lang: 'id', title, desc, url: base })}`;
  });
  sitemap.push(urlEntry(base));

  const listAlt = { id: abs(SECTIONS.id), en: abs(SECTIONS.en) };
  for (const lang of ['id', 'en']) {
    const s = S[lang], other = lang === 'id' ? 'en' : 'id';

    // list of every city, grouped by province
    const depth = SECTIONS[lang].split('/').length - 1;
    const groups = [...byProv].map(([p, list]) => `<h2>${esc(p)}</h2>\n<ul>${list.map((c) => `<li><a href="${href(lang, c)}">${esc(placeName(c.n, lang))}</a></li>`).join('')}</ul>`).join('\n');
    const listPage = page(shell, base, { lang, depth, title: s.listTitle, desc: s.listDesc, url: listAlt[lang], alt: listAlt });
    files[`${SECTIONS[lang]}index.html`] = swap(listPage, /<body>[\s\S]*<\/body>/, () => `<body>\n<main class="pages"><section class="seo">\n<h1>${s.listH1}</h1>\n<p>${s.listIntro}</p>\n<p><a href="./">${s.open}</a> · <a href="${SECTIONS[other]}" hreflang="${other}">${s.switchTo}</a></p>\n${groups}\n</section></main>\n</body>`);
    sitemap.push(urlEntry(listAlt[lang], listAlt));

    // one page per city
    for (const c of cities) {
      const name = placeName(c.n, lang), { y, m } = zonedYM(c.z, now), month = monthLabel(lang, y, m);
      const alt = { id: abs(href('id', c)), en: abs(href('en', c)) };
      const days = daysOf(c.id, y);
      const siblings = byProv.get(c.p).filter((x) => x.id !== c.id).map((x) => `<li><a href="${href(lang, x)}">${esc(placeName(x.n, lang))}</a></li>`).join('');
      const block = `<section class="seo" id="seo">\n<h1>${esc(s.h1(name))}</h1>\n<p>${esc(s.intro(name, c.p, c.z, month))}</p>\n`
        + (days ? monthTable(lang, c, y, m, days) + '\n' : '')
        + (siblings ? `<h2>${esc(s.others(c.p))}</h2>\n<ul>${siblings}</ul>\n` : '')
        + `<p><a href="${SECTIONS[lang]}">${s.all}</a> · <a href="${href(other, c)}" hreflang="${other}">${s.switchTo}</a></p>\n</section>`;
      const html = page(shell, base, { lang, depth: depth + 1, city: c.id, title: s.title(name, month), desc: s.desc(name, c.p), url: alt[lang], alt });
      files[`${href(lang, c)}index.html`] = swap(html, '<p class="foot" data-i18n="foot"></p>', (x) => `${x}\n${block}`);
      sitemap.push(urlEntry(alt[lang], alt));
    }
  }

  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemap.join('\n')}\n</urlset>\n`;
  return files;
}

async function main() {
  const site = path.resolve(process.argv[2] || '_site');
  let base = process.env.SITE_URL;
  if (!base) throw new Error('SITE_URL is required, e.g. https://<user>.github.io/<repo>/');
  if (!base.endsWith('/')) base += '/';
  const now = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();
  const shell = await fs.readFile(path.join(site, 'index.html'), 'utf8');
  const cities = JSON.parse(await fs.readFile(path.join(site, 'data', 'cities.json'), 'utf8'));
  const daysOf = (id, y) => {
    try { return JSON.parse(readFileSync(path.join(site, 'data', String(y), `${id}.json`), 'utf8')).days; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const files = buildSite({ shell, cities, base, now, daysOf });
  for (const [rel, body] of Object.entries(files)) {
    const out = path.join(site, rel);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, body);
  }
  console.log(`build-pages: ${Object.keys(files).length} files for ${cities.length} cities at ${base}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
