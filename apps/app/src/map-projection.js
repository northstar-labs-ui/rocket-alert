/** Equal-scale equirectangular projection for Israel outline SVG (viewBox 0–100).
 *  lon is scaled by cos(midLat) so x/y share the same ground scale.
 *  Must stay in sync with apps/app/src/assets/israel-outline.svg generation. */

export const LAT_MIN = 29.45;
export const LAT_MAX = 33.35;
export const LON_MIN = 34.20;
export const LON_MAX = 35.95;
export const MAP_PAD = 2;
export const FALLBACK_PIN = [50, 45]; // center-ish when lat/lon missing

const MID_LAT = (LAT_MIN + LAT_MAX) / 2;
export const MAP_COS = Math.cos(MID_LAT * Math.PI / 180);

const X_MIN = LON_MIN * MAP_COS;
const X_MAX = LON_MAX * MAP_COS;
const SPAN_X = X_MAX - X_MIN;
const SPAN_Y = LAT_MAX - LAT_MIN;
export const MAP_SCALE = (100 - 2 * MAP_PAD) / Math.max(SPAN_X, SPAN_Y);
export const MAP_OFF_X = (100 - 2 * MAP_PAD - SPAN_X * MAP_SCALE) / 2;
export const MAP_OFF_Y = (100 - 2 * MAP_PAD - SPAN_Y * MAP_SCALE) / 2;

function clamp01(v, lo = 0.02, hi = 0.98) {
  return Math.min(hi, Math.max(lo, v));
}

/** Project WGS84 lat/lon onto Israel outline SVG bounds. Returns [x%, y%]. */
export function projectLatLon(lat, lon) {
  const x = MAP_PAD + MAP_OFF_X + (lon * MAP_COS - X_MIN) * MAP_SCALE;
  const y = MAP_PAD + MAP_OFF_Y + (LAT_MAX - lat) * MAP_SCALE;
  return [clamp01(x / 100) * 100, clamp01(y / 100) * 100];
}
