# Jadwal Sholat

Daily prayer times for every regency and city in Indonesia, from the official schedule of the Ministry of Religious Affairs (Kementerian Agama). It runs as an installable web app, works offline, and covers all three time zones: WIB, WITA and WIT.

The whole app is static files on GitHub Pages. There is no backend, no account, and no tracking.

## How the data gets in

The app never calls a prayer-time API while you use it. A GitHub Actions workflow, "Build and deploy", does the fetching ahead of time:

1. `scripts/fetch-data.mjs` downloads the schedule from `api.myquran.com` and saves it as JSON.
2. The workflow commits any new files to `data/`.
3. It copies the app and the data into a site folder and publishes it to GitHub Pages.

The workflow runs on every push to `main` (pushes that only change Markdown files are skipped) and on the first day of each month. The script keeps files it has already downloaded, so a normal run only fetches what is missing. From November onward it also fetches the next year, so the schedule carries on past New Year.

The data comes in two shapes:

- `data/cities.json` lists every city with its ID, name, province, time zone and coordinates. The current data has 517 cities.
- `data/<year>/<cityId>.json` holds one city's year, one entry per day, with the times for imsak, subuh, terbit, dzuhur, ashar, maghrib and isya.

The coordinates come from OpenStreetMap's Nominatim service, looked up once while building the data. The app only uses them to find the nearest city when you ask it to.

## Offline and updates

A service worker (`sw.js`) saves the app itself (HTML, styles, scripts, icons and fonts) on the first visit. It saves each city's schedule the first time you open it, and refreshes that copy in the background when you are online. After the first visit, the app works with no connection.

Each deploy stamps the service worker with a hash of the app's files. The hash only changes when the app changes, so new schedule data or a README edit does not make phones download anything. When the app does change, the new version installs in the background and is used the next time you open it.

## Time zones

The countdown and the next prayer are worked out in the selected city's time zone, not the phone's. If you are in Bali and pick Jakarta, you see Jakarta's times.

## Location and privacy

On first launch the app guesses your city from the phone's time zone setting and asks you to confirm it. It asks for location permission only if you tap "Use my location". The nearest city is then found on the phone, and the coordinates are thrown away.

The app only loads files from its own site. It has no analytics, sets no cookies and makes no requests to other services. The font and icons ship with the app. Your city, language and theme are kept in the browser's local storage on your phone.

## Interface

The app speaks Bahasa Indonesia and English. It starts in the phone's language, and the globe button switches between them.

The sky in the header follows the time of day. To see a particular scene, add `?sky=dawn`, `?sky=day`, `?sky=dusk` or `?sky=night` to the URL.

The Hijri date is calculated by the browser with the Umm al-Qura calendar. Treat it as an estimate: it can be a day off from Indonesia's official date, which the government sets at the sidang isbat.

## Credits

- Prayer times: Kementerian Agama RI (Bimas Islam), served by [api.myquran.com](https://api.myquran.com). That service is run by the community; it is not an official government API.
- City coordinates: © OpenStreetMap contributors, through Nominatim.
- Weather icons: [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius, MIT License (`assets/meteocons/LICENSE`).
- Font: [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
