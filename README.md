# Jadwal Sholat

Prayer schedule PWA for all of Indonesia (WIB, WITA, WIT). Official Kemenag times, works offline, no tracking, no server. Hosted on GitHub Pages.

## Deploy

1. Create a new **public** GitHub repository (for example `jadwal-sholat`). The default branch must be `main`.
2. Upload everything in this folder, including the hidden `.github` folder.
   - With git: `git init && git add . && git commit -m "init" && git branch -M main && git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main`
   - Using GitHub's web "Upload files" page, the `.github` folder may get skipped because it is hidden. If so, create `.github/workflows/deploy.yml` by hand and paste in the file's contents.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source** to **GitHub Actions**.
4. Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. The workflow commits the fetched schedule data back to the repo.
5. Go to **Actions → Build and deploy → Run workflow**. A push also triggers it.
   - **The first run takes about 25–40 minutes.** It downloads 12 months of schedules for every kabupaten/kota (about 518 cities, roughly 6,200 small requests, paced to be polite to the API). Then it looks up each city's coordinates for the optional GPS button (1 request per second). Later runs only fetch what is missing and finish in a minute or two.
6. Open `https://<you>.github.io/<repo>/` on your phone.
   - **Android (Chrome):** tap "Install on home screen" in the app, or use the menu → Install app.
   - **iPhone (Safari):** Share → Add to Home Screen.

The workflow also runs on the 1st of every month. From November on, it fetches the next year's schedule, so the app keeps working past New Year.

## How it works

- **No runtime API.** A GitHub Action downloads the official Kemenag schedule from `api.myquran.com` into static JSON (`data/<year>/<cityId>.json`), commits it, and deploys. The app only reads those files.
- **Offline.** A service worker caches the app and every schedule you open. After the first visit, the app works without internet.
- **Correct timezone.** Countdown and "next prayer" use the selected city's zone (WIB/WITA/WIT), not the phone's, so viewing Jakarta from Bali is still right.
- **Location without permission.** On first launch, the city is estimated from the device's time zone setting, with a note asking you to confirm. GPS is optional: permission is only requested when you tap "Use my location". The nearest city is picked on the device, and the coordinates are discarded.
- **Privacy.** No analytics, no cookies, no third-party requests at runtime. The font and icons are bundled. Settings (city, language, theme) live only in the phone's local storage.
- **Languages.** Bahasa Indonesia and English. The default follows the phone's language; switch with the globe button.

## Preview the sky scenes

The header sky follows the real time of day. To preview a scene without waiting, add `?sky=dawn`, `?sky=day`, `?sky=dusk` or `?sky=night` to the URL.

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/
```

The `data/` folder is empty until the workflow has run. To fetch data locally instead (takes a while), run:

```bash
node scripts/fetch-data.mjs          # needs Node 18+
YEARS=2026 GEOCODE=0 node scripts/fetch-data.mjs   # one year, skip coordinates
```

## Troubleshooting

- **The workflow fails at "Commit new data" with a permission error:** check step 4 (Read and write permissions).
- **The deploy step fails:** check step 3 (Pages source set to GitHub Actions).
- **Some cities are missing:** the API may have rate-limited or failed for a few requests. Run the workflow again; it only fetches what is missing.
- **The phone shows an old version:** reopen the app. A "new version available" prompt appears; tap Reload.

## Data and credits

- **Prayer times:** Kementerian Agama RI (Bimas Islam), served by [api.myquran.com](https://api.myquran.com), a community-run service, not an official government API.
- **City coordinates:** © OpenStreetMap contributors (Nominatim), used only for the optional GPS city match.
- **Weather icons:** [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius, MIT License (`assets/meteocons/LICENSE`).
- **Font:** [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- **Hijri date:** computed by the browser using the Umm al-Qura calendar. It is an estimate and can differ by a day from Indonesia's official date (sidang isbat).
