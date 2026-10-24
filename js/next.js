// Pure time logic, kept out of app.js so tests can import it without a page.
export const sec = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60; };
const PRAYERS = [1, 3, 4, 5, 6]; // indices that count as "next prayer"

// T, yday, tmrw: [imsak, subuh, terbit, dzuhur, ashar, maghrib, isya]; yday and tmrw may be null. s: seconds since midnight.
export function computeNext(T, yday, tmrw, s) {
  for (const i of PRAYERS) if (sec(T[i]) > s) {
    const prevIdx = PRAYERS[PRAYERS.indexOf(i) - 1];
    const prev = prevIdx != null ? sec(T[prevIdx]) : yday ? sec(yday[6]) - 86400 : sec(T[i]) - 3600;
    return { i, target: sec(T[i]), prev, tomorrow: false };
  }
  const nt = tmrw ? sec(tmrw[1]) + 86400 : null;
  return { i: 1, target: nt, prev: sec(T[6]), tomorrow: true };
}
