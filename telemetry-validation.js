/* telemetry-validation.js — Cycle 3 telemetry validation + anomaly handling.
 *
 * Scope: validation ONLY (named checks, reject/hold/warn policy, data-quality
 * counters, and a small playback session that applies only accepted rows).
 * NOT playback timing, NOT LIVE/MANUAL switching, NOT the divergence badge,
 * NOT capacity physics, NOT the 3D model.
 *
 * Bounds sources (README-for-students.md §2 + capacity.js MCT88 config):
 *   load_t:        0..5 t max hook load; ±0.02 t sensor noise is normal.
 *                  ASYMMETRY NOTE: the −0.02 t lower tolerance is a noise floor,
 *                  not a symmetric band around the limits. An unloaded hook
 *                  legitimately reads ~0, and the documented ±0.02 t wobble can
 *                  drive that reading marginally negative — rejecting those
 *                  rows would discard valid unloaded-hook samples, while
 *                  negative mass is physically meaningless. The 5 t ceiling is
 *                  the crane's rated maximum hook load; there is no documented
 *                  allowance above it, so a strict ceiling holds last-good
 *                  rather than displaying a potentially overloaded state.
 *                  Zero load (0.00 t) with otherwise valid fields is VALID.
 *   radius_m:      trolley travel "about 4–29 m" (guide wording is approximate,
 *                  not a universal physical law). The strict 4–29 m range is a
 *                  documented-range interpretation for this exercise. Zero is
 *                  rejected, never clamped; every zero-radius row in this CSV
 *                  coincides with hook_height 0.00 and frozen columns
 *                  (suspected sensor dropout — see README).
 *   hook_height_m: roughly 2–46 m.
 *   slew_deg:      −180…+180, wraps at ±180. A normal wraparound crossing
 *                  (e.g. +179 → −179) must NOT be rejected.
 *   wind_kmh:      km/h. 40 km/h is an ALERT threshold, not a validity limit.
 *                  It is still required to be finite because it feeds the
 *                  capacity derate; negative wind is rejected as impossible.
 *   moment_pct:    derived device value. Missing/non-finite is WARN only: the
 *                  crane state can update, but the divergence badge is
 *                  unavailable for that sample.
 *   status_word:   decimal 13-bit mask. Missing/non-finite/out-of-mask is WARN.
 *   event:         empty or one of the three documented labels; anything else
 *                  is WARN.
 *
 * checkPhysicalJump is a WARN-only review heuristic, NOT a certified speed
 * limit: the kit sources give no crane speed limit. Thresholds are per-second
 * rates derived from the largest anomaly-free one-second changes observed in
 * the supplied CSV (radius ≤ 4.0 m/s, hook ≤ 0.7 m/s, slew ≤ 4.2 °/s), with
 * headroom (5 m/s, 3 m/s, 10 °/s). The check scales by elapsed time (Δt), so a
 * 3 m radius change in 2 s is 1.5 m/s and passes; it does not assume 1 Hz.
 *
 * Motion-bit consistency and reverse-direction checks use documented DRM 3400
 * status_word bits only. Tolerances are SIMULATION HEURISTICS derived from the
 * dataset, NOT certified crane limits. No manufacturer speed limits are supplied.
 *
 * Loss event grouping: consecutive invalid (REJECT) rows are grouped into a
 * single loss event with start/end timestamps and row count. A new event starts
 * after a gap of LOSS_EVENT_MIN_GAP_MS (default 2000 ms) or when a valid row
 * is accepted.
 *
 * NOT a certified safety system. Prototype study aid only.
 *
 * file:// compatible: plain script, no modules, no dependencies. Exposes the
 * single global `TelemetryValidation`.
 *
 * Playback integration (see script.js):
 *
 *   var store = TelemetryValidation.createStore();
 *   // per CSV line, in original device order:
 *   var parsed = TelemetryValidation.parseRow(cols);
 *   parsed.csvLine = lineNo; parsed.raw = line; parsed._columnCount = cols.length;
 *   parsed.validation = store.handle(parsed, { rowId: 'L' + lineNo });
 *
 *   var session = TelemetryValidation.createPlaybackSession({
 *     onAccept: function (row) { applyToCrane(row); }, // accepted + warn rows
 *     onWarn:   function (res) { showWarning(res); },
 *     onReject: function (res) { showHeld(res); }     // NEVER apply res.row
 *   });
 *   session.consume(row); // returns the validation result; rejected rows are
 *                         // not passed to onAccept, so crane state is held.
 */
var TelemetryValidation = (function () {
'use strict';

var LOAD_MAX_T = 5;          // MCT88 max hook load (guide §2, capacity.js)
var LOAD_NOISE_T = 0.02;     // documented load-cell noise — never rejected
var RADIUS_MIN_M = 4;        // trolley travel, guide column dict ("about 4–29 m")
var RADIUS_MAX_M = 29;
var HOOK_MIN_M = 2;          // hook height, guide column dict ("roughly 2–46 m")
var HOOK_MAX_M = 46;
var SLEW_LIMIT_DEG = 180;
var SLEW_WARN_TOL_DEG = 0.5; // overshoot within this -> WARN (rounding), beyond -> REJECT
var JUMP_RADIUS_RATE_MPS = 5;  // WARN-only review heuristic, scaled by elapsed seconds
var JUMP_HOOK_RATE_MPS = 3;    // normal observed max 0.7 m/s
var JUMP_SLEW_RATE_DPS = 10;   // normal observed max 4.2 °/s
var STATUS_MASK_MAX = 0x1FFF;  // bits 0..12 documented in README §3
var RECENT_CAP = 50;
var KNOWN_EVENTS = { '': true, 'OVERLOAD_WARN': true, 'WIND_ALERT': true, 'LS_TRIP': true };

// Documented DRM 3400 status_word bits (README-for-students.md §3)
var STATUS_BITS = {
  hoist: 0x0001,
  trolley: 0x0002,
  slew: 0x0004,
  utilisation: 0x0008,
  wind: 0x0040,
  overload: 0x0080,
  lsTrolleyOut: 0x0100,
  lsTrolleyIn: 0x0200,
  lsHookDown: 0x0400,
  lsHookUp: 0x0800,
  testMode: 0x1000
};

// Motion-bit consistency: tolerance for considering motion "present" vs "absent"
// These are SIMULATION HEURISTICS derived from the dataset, NOT certified crane limits.
var MOTION_TOLERANCE = {
  radiusM: 0.05,    // minimum radius change to consider "moving" (m)
  hookM: 0.05,      // minimum hook height change to consider "moving" (m)
  slewDeg: 0.1      // minimum slew change to consider "moving" (°)
};

// Reverse-direction: tolerance for direction disagreement (° or m/s)
var REVERSE_TOLERANCE = {
  radiusMps: 0.1,   // speed threshold to establish direction (m/s)
  hookMps: 0.1,     // speed threshold to establish direction (m/s)
  slewDps: 0.5      // slew rate threshold to establish direction (°/s)
};

// Loss event grouping
var LOSS_EVENT_MIN_GAP_MS = 2000; // gap between invalid rows to start new event (ms)

function isNum(x) { return typeof x === 'number' && isFinite(x); }

// Empty / missing CSV fields must NEVER silently become 0.
function toNum(s) {
  if (s === null || s === undefined) return NaN;
  var t = String(s).trim();
  if (t === '') return NaN;
  return Number(t);
}

function daysInMonth(y, m) {
  var d = new Date(Date.UTC(y, m, 0));
  if (y >= 0 && y < 100) d.setUTCFullYear(y);
  return d.getUTCDate();
}

/* Strict ISO-8601 parser. The README requires an explicit offset and says the
 * browser timezone must never be assumed. A timestamp without an offset is
 * therefore REJECTED (Date.parse would otherwise treat it as browser-local).
 * Returns { ok, ms, reason }.
 */
function parseTimestampStrict(value) {
  if (value === null || value === undefined) return { ok: false, ms: NaN, reason: 'missing' };
  var s = String(value).trim();
  if (!s) return { ok: false, ms: NaN, reason: 'missing' };
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return { ok: false, ms: NaN, reason: 'not ISO-8601 with an explicit offset' };

  var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  var sec = m[6] === undefined ? 0 : +m[6];
  var frac = m[7] || '';
  var msPart = frac ? +(frac + '000').slice(0, 3) : 0;
  var off = m[8];

  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) ||
      h > 23 || mi > 59 || sec > 59) {
    return { ok: false, ms: NaN, reason: 'out-of-range date/time' };
  }

  var offMin = 0;
  if (off !== 'Z') {
    var om = /^([+-])(\d{2}):(\d{2})$/.exec(off);
    if (!om) return { ok: false, ms: NaN, reason: 'invalid offset' };
    var oh = +om[2], omi = +om[3];
    if (oh > 23 || omi > 59) return { ok: false, ms: NaN, reason: 'invalid offset' };
    offMin = (om[1] === '-' ? -1 : 1) * (oh * 60 + omi);
  }

  var utcDate = new Date(Date.UTC(y, mo - 1, d, h, mi, sec, msPart));
  if (y >= 0 && y < 100) utcDate.setUTCFullYear(y);
  var utcMs = utcDate.getTime();
  if (!isFinite(utcMs)) return { ok: false, ms: NaN, reason: 'unparseable' };
  var ms = utcMs - offMin * 60000;
  if (!isFinite(ms)) return { ok: false, ms: NaN, reason: 'unparseable' };

  // Cross-check against the engine parser; both must agree on the instant.
  var engineMs = Date.parse(s);
  if (!isFinite(engineMs) || engineMs !== ms) {
    return { ok: false, ms: NaN, reason: 'timestamp does not round-trip' };
  }
  return { ok: true, ms: ms, reason: '' };
}

/* Parse one CSV row's fields into typed values. Accepts either an object with
 * the CSV column names (string values, e.g. from line.split(',')) or an
 * already-typed object / array. `imei` is ALWAYS kept a string (leading zeros
 * matter). Metadata added by the caller (csvLine, raw, _columnCount) is
 * preserved so diagnostics can report the original row.
 */
function parseRow(raw, meta) {
  var r = raw || {};
  var g = function (k, i) {
    if (r[k] !== undefined) return r[k];
    if (typeof i === 'number' && Array.isArray(raw)) return raw[i];
    return undefined;
  };
  var imeiRaw = g('imei', 1);
  var swRaw = g('status_word', 8);
  var sw = NaN;
  if (swRaw !== undefined && swRaw !== null) {
    var swText = String(swRaw).trim();
    if (/^[+-]?\d+$/.test(swText)) {
      sw = parseInt(swText, 10);
      if (!isFinite(sw)) sw = NaN;
    }
  }
  var row = {
    ts: g('ts', 0) === undefined || g('ts', 0) === null ? '' : String(g('ts', 0)).trim(),
    imei: imeiRaw === undefined || imeiRaw === null ? '' : String(imeiRaw).trim(),
    load_t: toNum(g('load_t', 2)),
    radius_m: toNum(g('radius_m', 3)),
    slew_deg: toNum(g('slew_deg', 4)),
    hook_height_m: toNum(g('hook_height_m', 5)),
    wind_kmh: toNum(g('wind_kmh', 6)),
    moment_pct: toNum(g('moment_pct', 7)),
    status_word: sw,
    event: g('event', 9) === undefined || g('event', 9) === null ? '' : String(g('event', 9)).trim(),
  };
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    if (r.csvLine !== undefined) row.csvLine = r.csvLine;
    if (r.raw !== undefined) row.raw = r.raw;
    if (r._columnCount !== undefined) row._columnCount = r._columnCount;
  }
  if (meta && typeof meta === 'object') {
    if (meta.csvLine !== undefined) row.csvLine = meta.csvLine;
    if (meta.raw !== undefined) row.raw = meta.raw;
    if (meta._columnCount !== undefined) row._columnCount = meta._columnCount;
  }
  return row;
}

function finding(rule, severity, message) {
  return { rule: rule, severity: severity, message: message };
}

/* 1. Required numeric telemetry must be finite. These fields are needed to
 * update the crane state safely; missing/invalid values are never coerced to
 * zero. `wind_kmh` is required because it feeds the capacity derate. */
function checkFiniteValues(row) {
  var out = [];
  var req = ['load_t', 'radius_m', 'slew_deg', 'hook_height_m', 'wind_kmh'];
  for (var i = 0; i < req.length; i++) {
    var k = req[i];
    if (!isNum(row[k])) {
      out.push(finding('checkFiniteValues', 'reject',
        k + ' is missing or non-finite (' + String(row[k]) + '); not defaulted to 0'));
    }
  }
  return out;
}

/* 1b. Derived/diagnostic fields. These do not prevent the crane state from
 * updating, so malformed values are WARN only. The divergence badge already
 * handles missing moment_pct as UNAVAILABLE. */
function checkAuxiliaryFields(row) {
  var out = [];
  if (!isNum(row.moment_pct)) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'moment_pct is missing or non-finite; device/computed divergence is unavailable for this sample'));
  } else if (row.moment_pct < 0) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'moment_pct=' + row.moment_pct + '% is negative; device-derived moment is implausible'));
  }
  if (!isNum(row.status_word)) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'status_word is missing or non-numeric; status bits unavailable for this sample'));
  } else if (row.status_word < 0 || row.status_word > STATUS_MASK_MAX) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'status_word=' + row.status_word + ' is outside the documented 13-bit mask 0..' + STATUS_MASK_MAX));
  }
  if (!row.imei) {
    out.push(finding('checkAuxiliaryFields', 'warn', 'imei is empty; device identity unavailable'));
  }
  if (!Object.prototype.hasOwnProperty.call(KNOWN_EVENTS, row.event)) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'event="' + row.event + '" is not one of the documented labels'));
  }
  if (row._columnCount !== undefined && row._columnCount !== 10) {
    out.push(finding('checkAuxiliaryFields', 'warn',
      'row has ' + row._columnCount + ' columns; expected 10'));
  }
  return out;
}

/* 2. Hook load: negative beyond sensor noise, or above the 5 t maximum.
 * The tolerance is deliberately asymmetric (see header): [-0.02, 5] is valid,
 * so an unloaded hook reading 0.00 (or wobbling to -0.01) is accepted. */
function checkLoadRange(row) {
  if (!isNum(row.load_t)) return []; // owned by checkFiniteValues
  if (row.load_t < -LOAD_NOISE_T) {
    return [finding('checkLoadRange', 'reject',
      'load_t=' + row.load_t + ' t is negative beyond ±' + LOAD_NOISE_T + ' t noise; max hook load ' + LOAD_MAX_T + ' t')];
  }
  if (row.load_t > LOAD_MAX_T) {
    return [finding('checkLoadRange', 'reject',
      'load_t=' + row.load_t + ' t exceeds ' + LOAD_MAX_T + ' t maximum hook load')];
  }
  return []; // [-0.02, 5] incl. noise wobble around zero is valid
}

/* 3. Trolley radius outside ~4–29 m. Zero is rejected under the dataset-
 * specific assumption documented in the header (no documented zero special
 * case; observed zero rows coincide with frozen-column dropout). Never clamped. */
/* 2b. Wind speed: finite is enforced by checkFiniteValues; negative values are
 * physically meaningless. 40 km/h is an alert threshold, not a validity limit,
 * so there is deliberately no upper bound here. */
function checkWindRange(row) {
  if (!isNum(row.wind_kmh)) return []; // owned by checkFiniteValues
  if (row.wind_kmh < 0) {
    return [finding('checkWindRange', 'reject',
      'wind_kmh=' + row.wind_kmh + ' km/h is negative; anemometer speed cannot be below zero')];
  }
  return [];
}

function checkRadiusRange(row) {
  if (!isNum(row.radius_m)) return [];
  if (row.radius_m < RADIUS_MIN_M || row.radius_m > RADIUS_MAX_M) {
    return [finding('checkRadiusRange', 'reject',
      'radius_m=' + row.radius_m + ' m outside trolley travel ~' +
      RADIUS_MIN_M + '–' + RADIUS_MAX_M + ' m; held, not clamped')];
  }
  return [];
}

/* 4. Hook height outside ~2–46 m. */
function checkHookHeightRange(row) {
  if (!isNum(row.hook_height_m)) return [];
  if (row.hook_height_m < HOOK_MIN_M || row.hook_height_m > HOOK_MAX_M) {
    return [finding('checkHookHeightRange', 'reject',
      'hook_height_m=' + row.hook_height_m + ' m outside ~' +
      HOOK_MIN_M + '–' + HOOK_MAX_M + ' m; held, not clamped')];
  }
  return [];
}

/* 5. Slew outside −180…+180. Small overshoot (<=0.5°) -> WARN (sensor rounding);
 * genuine out-of-range -> REJECT. Plain wrap crossings are always fine. */
function checkSlewRange(row) {
  if (!isNum(row.slew_deg)) return [];
  var a = Math.abs(row.slew_deg);
  if (a <= SLEW_LIMIT_DEG) return [];
  if (a <= SLEW_LIMIT_DEG + SLEW_WARN_TOL_DEG) {
    return [finding('checkSlewRange', 'warn',
      'slew_deg=' + row.slew_deg + '° is a small ±180° boundary overshoot (≤' +
      SLEW_WARN_TOL_DEG + '°); treated as rounding, not impossible')];
  }
  return [finding('checkSlewRange', 'reject',
    'slew_deg=' + row.slew_deg + '° outside −' + SLEW_LIMIT_DEG + '…+' +
    SLEW_LIMIT_DEG + '° beyond rounding tolerance')];
}

/* 6. Timestamp: strict ISO-8601 WITH offset; the browser zone is never assumed.
 * A missing offset is REJECTED rather than silently interpreted as local time.
 * Duplicates and out-of-order arrival are WARN-only so one clock glitch cannot
 * freeze the twin; unparseable/missing is REJECT. */
function checkTimestamp(row, ctx) {
  var c = ctx || {};
  var parsed = parseTimestampStrict(row.ts);
  if (!parsed.ok) {
    return [finding('checkTimestamp', 'reject',
      'ts=' + (row.ts || '(missing)') + ' is ' + parsed.reason +
      ' (ISO-8601 with an explicit offset is required)')];
  }
  var out = [];
  var ms = parsed.ms;
  var seen = c.seen || null;
  var isDup = false;
  if (seen) {
    if (Object.prototype.hasOwnProperty.call(seen, row.ts)) isDup = true;
    if (Object.prototype.hasOwnProperty.call(seen, '@' + ms)) isDup = true;
  }
  if (isDup) {
    out.push(finding('checkTimestamp', 'warn',
      'ts=' + row.ts + ' is a duplicate timestamp/instant'));
  }
  if (c.lastMs !== undefined && c.lastMs !== null && isNum(c.lastMs) && ms < c.lastMs) {
    out.push(finding('checkTimestamp', 'warn',
      'ts=' + row.ts + ' arrived out of order'));
  }
  return out;
}

function wrapSlewDelta(a, b) {
  var d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* 7. Implausible position jumps between consecutive samples. WARN-only review
 * heuristic — the kit sources state NO crane speed limit, so this module never
 * certifies a jump "physically impossible". The per-second thresholds are
 * scaled by elapsed time, so cadence is not assumed to be exactly 1 Hz. */
function checkPhysicalJump(row, prev) {
  if (!prev) return [];
  var a = parseTimestampStrict(row.ts);
  var b = parseTimestampStrict(prev.ts);
  if (!a.ok || !b.ok) return [];
  var dtS = (a.ms - b.ms) / 1000;
  if (!(dtS > 0)) return [];

  var out = [];
  if (isNum(row.radius_m) && isNum(prev.radius_m)) {
    var dr = Math.abs(row.radius_m - prev.radius_m);
    var drRate = dr / dtS;
    if (drRate > JUMP_RADIUS_RATE_MPS) {
      out.push(finding('checkPhysicalJump', 'warn',
        'radius jump ' + prev.radius_m + '→' + row.radius_m + ' m (Δ' + dr.toFixed(2) +
        ' m in ' + dtS + ' s = ' + drRate.toFixed(1) + ' m/s) exceeds ' +
        JUMP_RADIUS_RATE_MPS + ' m/s review heuristic; not a certified limit'));
    }
  }
  if (isNum(row.hook_height_m) && isNum(prev.hook_height_m)) {
    var dh = Math.abs(row.hook_height_m - prev.hook_height_m);
    var dhRate = dh / dtS;
    if (dhRate > JUMP_HOOK_RATE_MPS) {
      out.push(finding('checkPhysicalJump', 'warn',
        'hook-height jump ' + prev.hook_height_m + '→' + row.hook_height_m + ' m (Δ' + dh.toFixed(2) +
        ' m in ' + dtS + ' s = ' + dhRate.toFixed(1) + ' m/s) exceeds ' +
        JUMP_HOOK_RATE_MPS + ' m/s review heuristic; not a certified limit'));
    }
  }
  if (isNum(row.slew_deg) && isNum(prev.slew_deg)) {
    var ds = wrapSlewDelta(row.slew_deg, prev.slew_deg);
    var dsRate = ds / dtS;
    if (dsRate > JUMP_SLEW_RATE_DPS) {
      out.push(finding('checkPhysicalJump', 'warn',
        'slew jump ' + prev.slew_deg + '→' + row.slew_deg + '° (wrap-aware Δ' + ds.toFixed(1) +
        '° in ' + dtS + ' s = ' + dsRate.toFixed(1) + ' °/s) exceeds ' +
        JUMP_SLEW_RATE_DPS + ' °/s review heuristic; not a certified limit'));
    }
  }
  return out;
}

/* 8. Motion-bit consistency: compare status_word motion bits with measured motion.
 * Bits: hoist (0x0001), trolley (0x0002), slew (0x0004).
 * WARN if motion bit set but measured change below tolerance, or vice versa.
 * REJECT if contradictory bits set simultaneously (e.g., hoist up + hoist down). */
function checkMotionBitConsistency(row, prev) {
  if (!prev) return [];
  if (!isNum(row.status_word)) return [];
  if (!isNum(row.radius_m) || !isNum(prev.radius_m) ||
      !isNum(row.hook_height_m) || !isNum(prev.hook_height_m) ||
      !isNum(row.slew_deg) || !isNum(prev.slew_deg)) return [];

  var sw = row.status_word >>> 0;
  var hoistBit = (sw & STATUS_BITS.hoist) !== 0;
  var trolleyBit = (sw & STATUS_BITS.trolley) !== 0;
  var slewBit = (sw & STATUS_BITS.slew) !== 0;
  var lsHookUp = (sw & STATUS_BITS.lsHookUp) !== 0;
  var lsHookDown = (sw & STATUS_BITS.lsHookDown) !== 0;
  var lsTrolleyOut = (sw & STATUS_BITS.lsTrolleyOut) !== 0;
  var lsTrolleyIn = (sw & STATUS_BITS.lsTrolleyIn) !== 0;

  var out = [];

  // Conflicting limit switches (mutually exclusive)
  if (lsHookUp && lsHookDown) {
    out.push(finding('checkMotionBitConsistency', 'reject',
      'Conflicting limit switches: lsHookUp and lsHookDown both set'));
  }
  if (lsTrolleyOut && lsTrolleyIn) {
    out.push(finding('checkMotionBitConsistency', 'reject',
      'Conflicting limit switches: lsTrolleyOut and lsTrolleyIn both set'));
  }

  // Need previous row to compute measured motion
  var dr = row.radius_m - prev.radius_m;
  var dh = row.hook_height_m - prev.hook_height_m;
  var rawDs = row.slew_deg - prev.slew_deg;
  if (rawDs > 180) rawDs -= 360;
  else if (rawDs < -180) rawDs += 360;

  var radiusMoving = Math.abs(dr) > MOTION_TOLERANCE.radiusM;
  var hookMoving = Math.abs(dh) > MOTION_TOLERANCE.hookM;
  var slewMoving = Math.abs(rawDs) > MOTION_TOLERANCE.slewDeg;

  // Motion bit indicates movement but measured motion absent
  if (trolleyBit && !radiusMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Trolley motion bit set but radius change ' + dr.toFixed(3) + ' m below tolerance ' +
      MOTION_TOLERANCE.radiusM + ' m'));
  }
  if (hoistBit && !hookMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Hoist motion bit set but hook height change ' + dh.toFixed(3) + ' m below tolerance ' +
      MOTION_TOLERANCE.hookM + ' m'));
  }
  if (slewBit && !slewMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Slew motion bit set but slew change ' + rawDs.toFixed(3) + '° below tolerance ' +
      MOTION_TOLERANCE.slewDeg + '°'));
  }

  // Measured movement present but motion bit not set
  if (!trolleyBit && radiusMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Radius change ' + dr.toFixed(3) + ' m detected but trolley motion bit not set'));
  }
  if (!hoistBit && hookMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Hook height change ' + dh.toFixed(3) + ' m detected but hoist motion bit not set'));
  }
  if (!slewBit && slewMoving) {
    out.push(finding('checkMotionBitConsistency', 'warn',
      'Slew change ' + rawDs.toFixed(3) + '° detected but slew motion bit not set'));
  }

  return out;
}

/* 9. Reverse-direction checks: compare motion bit direction with measured direction.
 * Only meaningful when both bit and measured motion indicate movement.
 * Uses REVERSE_TOLERANCE thresholds to avoid flagging sensor noise. */
function checkReverseDirection(row, prev) {
  if (!prev) return [];
  if (!isNum(row.status_word)) return [];
  if (!isNum(row.radius_m) || !isNum(prev.radius_m) ||
      !isNum(row.hook_height_m) || !isNum(prev.hook_height_m) ||
      !isNum(row.slew_deg) || !isNum(prev.slew_deg)) return [];

  var sw = row.status_word >>> 0;
  var hoistBit = (sw & STATUS_BITS.hoist) !== 0;
  var trolleyBit = (sw & STATUS_BITS.trolley) !== 0;
  var slewBit = (sw & STATUS_BITS.slew) !== 0;
  var lsHookUp = (sw & STATUS_BITS.lsHookUp) !== 0;
  var lsHookDown = (sw & STATUS_BITS.lsHookDown) !== 0;
  var lsTrolleyOut = (sw & STATUS_BITS.lsTrolleyOut) !== 0;
  var lsTrolleyIn = (sw & STATUS_BITS.lsTrolleyIn) !== 0;

  var out = [];

  // Need timestamps to compute rates
  var a = parseTimestampStrict(row.ts);
  var b = parseTimestampStrict(prev.ts);
  if (!a.ok || !b.ok) return out;
  var dtS = (a.ms - b.ms) / 1000;
  if (!(dtS > 0)) return out;

  var dr = row.radius_m - prev.radius_m;
  var dh = row.hook_height_m - prev.hook_height_m;
  var rawDs = row.slew_deg - prev.slew_deg;
  if (rawDs > 180) rawDs -= 360;
  else if (rawDs < -180) rawDs += 360;

  var radiusRate = dr / dtS;
  var hookRate = dh / dtS;
  var slewRate = rawDs / dtS;

  // Hoist: lsHookUp means hook going up (positive dh), lsHookDown means down (negative dh)
  if (hoistBit && Math.abs(hookRate) > REVERSE_TOLERANCE.hookMps) {
    var hookDir = hookRate > 0 ? 'up' : 'down';
    var bitDir = lsHookUp ? 'up' : (lsHookDown ? 'down' : 'unknown');
    if (bitDir !== 'unknown' && hookDir !== bitDir) {
      out.push(finding('checkReverseDirection', 'warn',
        'Hoist reverse-direction: motion bit indicates ' + bitDir +
        ' but measured hook rate ' + hookRate.toFixed(2) + ' m/s indicates ' + hookDir));
    }
  }

  // Trolley: lsTrolleyOut means radius increasing (positive dr), lsTrolleyIn means decreasing
  if (trolleyBit && Math.abs(radiusRate) > REVERSE_TOLERANCE.radiusMps) {
    var radiusDir = radiusRate > 0 ? 'out' : 'in';
    var bitDir = lsTrolleyOut ? 'out' : (lsTrolleyIn ? 'in' : 'unknown');
    if (bitDir !== 'unknown' && radiusDir !== bitDir) {
      out.push(finding('checkReverseDirection', 'warn',
        'Trolley reverse-direction: motion bit indicates ' + bitDir +
        ' but measured radius rate ' + radiusRate.toFixed(2) + ' m/s indicates ' + radiusDir));
    }
  }

  // Slew: direction from slew rate (positive = CCW, negative = CW)
  // No dedicated slew limit switch bits in documented schema; skip bit comparison

  return out;
}

/* Run all checks in device order. ctx: { seen:{}, lastMs, prev } — the store
 * threads this through; direct callers may pass {} or omit it.
 * Returns { valid, severity, reasons, findings, row, timestamp, timestampMs }.
 * Policy: valid=false (REJECT) only on conclusively invalid samples; WARN
 * samples stay valid so the twin keeps following with a flag. */
function validateRow(row, ctx) {
  var c = ctx || {};
  if (!row || typeof row !== 'object') row = parseRow({});
  var fs = [];
  fs = fs.concat(checkFiniteValues(row));
  fs = fs.concat(checkAuxiliaryFields(row));
  fs = fs.concat(checkLoadRange(row));
  fs = fs.concat(checkWindRange(row));
  fs = fs.concat(checkRadiusRange(row));
  fs = fs.concat(checkHookHeightRange(row));
  fs = fs.concat(checkSlewRange(row));
  fs = fs.concat(checkTimestamp(row, c));
  fs = fs.concat(checkPhysicalJump(row, c.prev || null));
  fs = fs.concat(checkMotionBitConsistency(row, c.prev || null));
  fs = fs.concat(checkReverseDirection(row, c.prev || null));
  var severity = 'ok';
  for (var i = 0; i < fs.length; i++) {
    if (fs[i].severity === 'reject') { severity = 'reject'; break; }
    if (fs[i].severity === 'warn') severity = 'warn';
  }
  var reasons = fs.map(function (f) { return f.rule + ': ' + f.message; });
  var ts = parseTimestampStrict(row.ts);
  return {
    valid: severity !== 'reject',
    severity: severity,
    reasons: reasons,
    findings: fs,
    row: row,
    timestamp: row.ts,
    timestampMs: ts.ok ? ts.ms : NaN,
  };
}

/* Store: last-good state + data-quality counters + recent anomalies + loss events.
 *
 * Counters count UNIQUE ROWS when the caller supplies a stable rowId (CSV line
 * number — REQUIRED for honest counts), otherwise they count handling events.
 * A repeated rowId (e.g. UI re-render/replay of the same sample) revalidates
 * for display but does NOT increment counters and does NOT duplicate
 * recent-anomaly entries — the result carries counted:false in that case.
 *
 * Counters are dataset-level: they are populated by a full-file validation
 * pass and do not increase again when playback revisits a row.
 *
 * Loss events: consecutive REJECT rows are grouped into single loss events.
 * Each loss event has: startTs, endTs, startLine, endLine, rowCount, firstReason.
 * A new loss event starts when:
 *   - The first REJECT row is encountered
 *   - A gap of > LOSS_EVENT_MIN_GAP_MS between consecutive REJECT rows
 *   - A valid (OK/WARN) row breaks the consecutive REJECT sequence
 */
function createStore() {
  var store = {
    lastGood: null,
    total: 0,
    accepted: 0,
    rejected: 0,
    held: 0,
    warnings: 0,
    byRule: {},
    reasonHits: {},
    lastResult: null,
    recent: [],
    _counted: {},
    _seenTs: {},
    _lastMs: null,
    _prev: null,
    // Loss event tracking
    _currentLossEvent: null,
    _lossEvents: [],
    _lastRejectTsMs: null,

    handle: function (rawOrParsed, opts) {
      var o = opts || {};
      var parsed = parseRow(rawOrParsed);
      var ctx = { seen: this._seenTs, lastMs: this._lastMs, prev: this._prev };
      var res = validateRow(parsed, ctx);
      if (isNum(res.timestampMs)) {
        this._lastMs = res.timestampMs;
        this._seenTs[parsed.ts] = true;
        this._seenTs['@' + res.timestampMs] = true;
      }
      this._prev = parsed;

      var rowId = (o.rowId === undefined || o.rowId === null) ? null : String(o.rowId);
      var fresh = rowId === null || !Object.prototype.hasOwnProperty.call(this._counted, rowId);
      if (rowId !== null) this._counted[rowId] = true;
      res.rowId = rowId;
      res.line = parsed.csvLine !== undefined ? parsed.csvLine : null;
      res.counted = fresh;
      res.action = res.valid ? (res.severity === 'warn' ? 'accept-warn' : 'accept') : 'reject-hold';

      // Loss event grouping for consecutive REJECT rows
      if (fresh && !res.valid) {
        var rejectTsMs = res.timestampMs;
        var startNewEvent = false;
        if (!this._currentLossEvent) {
          startNewEvent = true;
        } else if (!isNum(this._lastRejectTsMs) || !isNum(rejectTsMs) ||
                   (rejectTsMs - this._lastRejectTsMs) > LOSS_EVENT_MIN_GAP_MS) {
          startNewEvent = true;
        }
        if (startNewEvent) {
          // Close previous event if exists
          if (this._currentLossEvent) {
            this._lossEvents.push(this._currentLossEvent);
            if (this._lossEvents.length > RECENT_CAP) this._lossEvents.shift();
          }
          // Start new loss event
          this._currentLossEvent = {
            startTs: parsed.ts,
            startTsMs: rejectTsMs,
            startLine: res.line,
            endTs: parsed.ts,
            endTsMs: rejectTsMs,
            endLine: res.line,
            rowCount: 1,
            firstReason: res.reasons[0] || 'unknown',
            reasons: [res.reasons.slice()]
          };
        } else {
          // Extend current loss event
          this._currentLossEvent.endTs = parsed.ts;
          this._currentLossEvent.endTsMs = rejectTsMs;
          this._currentLossEvent.endLine = res.line;
          this._currentLossEvent.rowCount++;
          this._currentLossEvent.reasons.push(res.reasons.slice());
        }
        this._lastRejectTsMs = rejectTsMs;
      } else if (fresh && res.valid) {
        // Valid row breaks any ongoing loss event
        if (this._currentLossEvent) {
          this._lossEvents.push(this._currentLossEvent);
          if (this._lossEvents.length > RECENT_CAP) this._lossEvents.shift();
          this._currentLossEvent = null;
          this._lastRejectTsMs = null;
        }
      }

      if (fresh) {
        this.total++;
        if (res.valid) {
          this.accepted++;
          if (res.severity === 'warn') this.warnings++;
          this.lastGood = parsed;
        } else {
          this.rejected++;
          this.held++; // every rejection holds the last good state (never animates to impossible)
        }
        var seenRules = {};
        for (var i = 0; i < res.findings.length; i++) {
          var rule = res.findings[i].rule;
          this.reasonHits[rule] = (this.reasonHits[rule] || 0) + 1;
          if (!seenRules[rule]) {
            this.byRule[rule] = (this.byRule[rule] || 0) + 1;
            seenRules[rule] = true;
          }
        }
        if (res.severity !== 'ok') {
          this.recent.unshift({
            rowId: rowId,
            line: res.line,
            timestamp: parsed.ts,
            severity: res.severity,
            reasons: res.reasons.slice(),
            findings: res.findings.slice(),
          });
          if (this.recent.length > RECENT_CAP) this.recent.length = RECENT_CAP;
        }
      }
      this.lastResult = res;
      return res;
    },

    getCounts: function () {
      return {
        total: this.total,
        accepted: this.accepted,
        rejected: this.rejected,
        held: this.held,
        warnings: this.warnings,
        byRule: Object.assign({}, this.byRule),
        reasonHits: Object.assign({}, this.reasonHits),
      };
    },
    getLastGood: function () { return this.lastGood; },
    getLastResult: function () { return this.lastResult; },
    getRecent: function (n) {
      if (n === undefined || n === null) return this.recent.slice();
      return this.recent.slice(0, n);
    },
    getLossEvents: function (n) {
      var events = this._lossEvents.slice();
      if (this._currentLossEvent) events.push(this._currentLossEvent);
      if (n === undefined || n === null) return events;
      return events.slice(-n);
    },
    reset: function () {
      this.lastGood = null; this.total = 0; this.accepted = 0; this.rejected = 0;
      this.held = 0; this.warnings = 0; this.byRule = {}; this.reasonHits = {};
      this.lastResult = null; this.recent = []; this._counted = {};
      this._seenTs = {}; this._lastMs = null; this._prev = null;
      this._currentLossEvent = null; this._lossEvents = []; this._lastRejectTsMs = null;
    },
  };
  return store;
}

/* Playback session: consults a row's precomputed validation result and calls
 * onAccept only for OK/WARN rows. A rejected row never reaches onAccept, so the
 * caller's crane state is held. The session also tracks lastAccepted for
 * diagnostics/tests. */
function createPlaybackSession(opts) {
  var o = opts || {};
  var lastAccepted = null;
  var lastResult = null;
  var applied = 0;
  var rejected = 0;
  return {
    consume: function (row) {
      var res = (row && row.validation) ? row.validation : validateRow(row, {});
      lastResult = res;
      if (!res.valid) {
        rejected++;
        if (typeof o.onReject === 'function') o.onReject(res, row);
        return res;
      }
      applied++;
      lastAccepted = row;
      if (res.severity === 'warn' && typeof o.onWarn === 'function') o.onWarn(res, row);
      if (typeof o.onAccept === 'function') o.onAccept(row, res);
      return res;
    },
    getLastAccepted: function () { return lastAccepted; },
    getLastResult: function () { return lastResult; },
    getStats: function () { return { applied: applied, rejected: rejected }; },
  };
}

/* Optional dashboard hook: fills #dqTotal/#dqAccepted/#dqRejected/#dqWarnings/
 * #dqHeld/#dqCurrent/#dqCurrentBadge/#dqLastReason/#dqRuleBreakdown/#dqRecent
 * when a Cycle 3 counter panel exists; silent no-op otherwise. The panel itself
 * belongs to the UI layer; this function never redesigns it. */
function renderCounterPanel(store, doc, currentResult) {
  try {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !store) return false;
    var set = function (id, txt) {
      var el = d.getElementById ? d.getElementById(id) : null;
      if (el) el.textContent = txt;
    };
    var c = store.getCounts();
    set('dqTotal', String(c.total));
    set('dqAccepted', String(c.accepted));
    set('dqRejected', String(c.rejected));
    set('dqWarnings', String(c.warnings));
    set('dqHeld', String(c.held));

    var current = (currentResult === undefined) ? store.getLastResult() : currentResult;
    var badge = d.getElementById ? d.getElementById('dqCurrentBadge') : null;
    if (!current) {
      set('dqCurrent', '—');
      set('dqLastReason', 'No sample processed yet.');
      if (badge) { badge.textContent = '—'; badge.className = 'dq-badge dq-idle'; }
    } else {
      var where = current.rowId || (current.line !== null && current.line !== undefined ? ('L' + current.line) : 'row');
      set('dqCurrent', where + ' · ' + (current.timestamp || '—'));
      if (badge) {
        badge.textContent = current.severity === 'reject' ? 'REJECT' : (current.severity === 'warn' ? 'WARN' : 'OK');
        badge.className = 'dq-badge ' + (current.severity === 'reject' ? 'dq-reject' : (current.severity === 'warn' ? 'dq-warn' : 'dq-ok'));
      }
      set('dqLastReason', current.reasons.length ? current.reasons.join('; ') : 'All applicable checks passed.');
    }
    var entries = Object.keys(c.byRule).sort();
    set('dqRuleBreakdown', entries.length
      ? entries.map(function (k) { return k + '=' + c.byRule[k]; }).join(' · ')
      : 'Rules hit: —');

    var recent = store.getRecent(5);
    var list = d.getElementById ? d.getElementById('dqRecent') : null;
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      recent.forEach(function (r) {
        if (!d.createElement) return;
        var li = d.createElement('li');
        var where = r.rowId || (r.line !== null && r.line !== undefined ? ('L' + r.line) : 'row');
        li.textContent = where + ' · ' + r.timestamp + ' [' + r.severity + '] ' + (r.reasons[0] || '');
        list.appendChild(li);
      });
    }
    return true;
  } catch (e) { return false; }
}

return {
  LOAD_MAX_T: LOAD_MAX_T,
  LOAD_NOISE_T: LOAD_NOISE_T,
  RADIUS_MIN_M: RADIUS_MIN_M,
  RADIUS_MAX_M: RADIUS_MAX_M,
  HOOK_MIN_M: HOOK_MIN_M,
  HOOK_MAX_M: HOOK_MAX_M,
  SLEW_LIMIT_DEG: SLEW_LIMIT_DEG,
  SLEW_WARN_TOL_DEG: SLEW_WARN_TOL_DEG,
  // Per-second WARN thresholds (heuristics, not certified limits).
  JUMP_RADIUS_RATE_MPS: JUMP_RADIUS_RATE_MPS,
  JUMP_HOOK_RATE_MPS: JUMP_HOOK_RATE_MPS,
  JUMP_SLEW_RATE_DPS: JUMP_SLEW_RATE_DPS,
  // Back-compatible names for the same one-second thresholds.
  JUMP_RADIUS_WARN_M: JUMP_RADIUS_RATE_MPS,
  JUMP_HOOK_WARN_M: JUMP_HOOK_RATE_MPS,
  JUMP_SLEW_WARN_DEG: JUMP_SLEW_RATE_DPS,
  // Motion-bit and reverse-direction thresholds (SIMULATION HEURISTICS).
  MOTION_TOLERANCE: MOTION_TOLERANCE,
  REVERSE_TOLERANCE: REVERSE_TOLERANCE,
  LOSS_EVENT_MIN_GAP_MS: LOSS_EVENT_MIN_GAP_MS,
  STATUS_BITS: STATUS_BITS,
  parseTimestampStrict: parseTimestampStrict,
  parseRow: parseRow,
  checkFiniteValues: checkFiniteValues,
  checkAuxiliaryFields: checkAuxiliaryFields,
  checkLoadRange: checkLoadRange,
  checkWindRange: checkWindRange,
  checkRadiusRange: checkRadiusRange,
  checkHookHeightRange: checkHookHeightRange,
  checkSlewRange: checkSlewRange,
  checkTimestamp: checkTimestamp,
  checkPhysicalJump: checkPhysicalJump,
  checkMotionBitConsistency: checkMotionBitConsistency,
  checkReverseDirection: checkReverseDirection,
  validateRow: validateRow,
  createStore: createStore,
  createPlaybackSession: createPlaybackSession,
  renderCounterPanel: renderCounterPanel,
};
})();

if (typeof window !== 'undefined') window.TelemetryValidation = TelemetryValidation;
if (typeof module !== 'undefined' && module.exports) module.exports = TelemetryValidation;