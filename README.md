# Jadwal Sholat

Jadwal Sholat is a progressive web app that shows daily prayer times for every regency and city (kabupaten/kota) in Indonesia, across all three time zones: WIB, WITA and WIT. The times come from the official schedule published by the Ministry of Religious Affairs (Kementerian Agama). The app is a static site hosted on GitHub Pages, so it has no backend server of its own.

## Architecture

The app never calls a prayer-time API while it is running. Instead, a scheduled GitHub Actions workflow named "Build and deploy" runs the script `scripts/fetch-data.mjs`, which downloads the official schedule from `api.myquran.com` and stores it as static JSON files. The list of cities, with their province, time zone and coordinates, is saved in `data/cities.json`. Each city's schedule for a year is saved in `data/<year>/<cityId>.json`, with one entry per day containing the times for imsak, subuh, terbit, dzuhur, ashar, maghrib and isya.

The workflow commits any new data files back to the repository and then publishes the site to GitHub Pages. It runs on every push to `main` and on the first day of each month. The script keeps files that already exist, so later runs only fetch what is missing. From November onward, it also fetches the following year's schedule, so the app keeps working after New Year.

City coordinates are looked up once, during the data build, through OpenStreetMap's Nominatim service. They are used only for the optional location-based city match.

## Offline support

A service worker (`sw.js`) caches the application shell, including the HTML, styles, scripts, icons and fonts. It also caches each city's schedule the first time that schedule is opened. After the first visit, the app works without an internet connection. Each deployment stamps a new build identifier into the service worker, which prompts installed copies of the app to offer the new version.

## Time zones

The countdown and the "next prayer" indicator are calculated in the selected city's time zone, not in the time zone of the device. For example, a user in Bali who selects Jakarta still sees the correct times for Jakarta.

## Location and privacy

On first launch, the app estimates the user's city from the device's time zone setting and asks the user to confirm it. Precise location is optional. The browser only asks for location permission when the user taps "Use my location". The nearest city is then chosen on the device itself, and the coordinates are discarded.

The app does not use analytics, cookies or any third-party requests at runtime. The font and weather icons are bundled with the site. User settings, such as the selected city, language and theme, are stored only in the browser's local storage on the device.

## Interface

The app is available in Bahasa Indonesia and English. It follows the device's language by default, and the user can switch languages with the globe button. The sky illustration in the header changes with the real time of day. A specific scene can be previewed by adding `?sky=dawn`, `?sky=day`, `?sky=dusk` or `?sky=night` to the URL.

The Hijri date is calculated by the browser using the Umm al-Qura calendar. It is an estimate, and it may differ by one day from Indonesia's official date, which is set by the government's sidang isbat.

## Data sources and credits

Prayer times come from the Ministry of Religious Affairs (Bimas Islam) and are served by [api.myquran.com](https://api.myquran.com). That service is run by the community and is not an official government API. City coordinates are © OpenStreetMap contributors, obtained through Nominatim. The weather icons are [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius, released under the MIT License (see `assets/meteocons/LICENSE`). The font is [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), released under the SIL Open Font License 1.1 (see `assets/fonts/OFL.txt`).
