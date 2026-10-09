/* divergence.js — Device vs Computed Utilisation Comparison (Cycle 3)
 *
 * Compares the device-reported moment_pct (load_t * radius_m / 81 * 100)
 * against an independently computed utilisation using capacityAt() which
 * respects corner radius, max capacity, and wind derating.
 *
 * Exposes: DivergenceAPI.compute(row, config) -> result object
 */

(function () {
'use strict';

/** Reference load moment for MCT 88 at 30 m jib (t·m) */
const REFERENCE_MOMENT = 81;

/** Default divergence threshold in percentage points */
const DEFAULT_THRESHOLD_PCT = 5;

/**
 * Validates that a value is a finite, non-negative number.
 * @param {any} v
 * @returns {boolean}
 */
function isValidNumber(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0;
}

/**
 * Computes the device-reported moment percentage from telemetry row.
 * Formula: load_t * radius_m / 81 * 100
 * @param {Object} row - Telemetry row with load_t, radius_m
 * @returns {number|null} Moment percentage or null if invalid
 */
function computeDeviceMomentPct(row) {
  if (!row || !isValidNumber(row.load_t) || !isValidNumber(row.radius_m)) {
    return null;
  }
  if (row.radius_m <= 0) return null;
  return (row.load_t * row.radius_m / REFERENCE_MOMENT) * 100;
}

/**
 * Computes utilisation using the capacity model (capacityAt).
 * This respects corner radius, max capacity (5 t), and wind derating.
 * @param {Object} row - Telemetry row with load_t, radius_m, wind_kmh
 * @param {Object} config - Configuration { jibLen, windKmh }
 * @returns {number|null} Utilisation percentage or null if invalid
 */
function computeUtilisation(row, config) {
  if (!row || !isValidNumber(row.load_t) || !isValidNumber(row.radius_m)) {
    return null;
  }
  if (!config || !isValidNumber(config.jibLen) || config.jibLen <= 0) {
    return null;
  }

  const radius = row.radius_m;
  const load = row.load_t;
  const windKmh = (config.windKmh !== undefined && isValidNumber(config.windKmh))
    ? config.windKmh
    : 0;

  // Capacity is null if radius exceeds jib length
  if (radius > config.jibLen) {
    return null;
  }

  const cap = capacityAt(MCT88, config.jibLen, radius, windKmh);
  if (cap == null || cap <= 0) {
    return null;
  }

  return (load / cap) * 100;
}

/**
 * Computes the divergence comparison result.
 * @param {Object} row - Telemetry row
 * @param {Object} config - Configuration { jibLen, windKmh, thresholdPct }
 * @returns {Object} Result object with:
 *   deviceMomentPct: number|null
 *   computedUtilPct: number|null
 *   divergencePct: number|null (absolute difference)
 *   isDivergent: boolean
 *   status: 'agree' | 'divergent' | 'invalid'
 *   reason: string (explanation for invalid status)
 */
function computeDivergence(row, config) {
  const threshold = (config && isValidNumber(config.thresholdPct))
    ? config.thresholdPct
    : DEFAULT_THRESHOLD_PCT;

  // Validate required inputs
  if (!row) {
    return {
      deviceMomentPct: null,
      computedUtilPct: null,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'No telemetry row provided'
    };
  }

  // Check for missing or invalid critical fields
  if (!isValidNumber(row.load_t)) {
    return {
      deviceMomentPct: null,
      computedUtilPct: null,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'Invalid or missing load_t'
    };
  }
  if (!isValidNumber(row.radius_m)) {
    return {
      deviceMomentPct: null,
      computedUtilPct: null,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'Invalid or missing radius_m'
    };
  }
  if (!isValidNumber(row.moment_pct)) {
    return {
      deviceMomentPct: null,
      computedUtilPct: null,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'Invalid or missing moment_pct'
    };
  }

  const devicePct = computeDeviceMomentPct(row);
  const computedPct = computeUtilisation(row, config);

  // If either computation failed, mark as invalid
  if (devicePct === null) {
    return {
      deviceMomentPct: null,
      computedUtilPct: computedPct,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'Device moment calculation failed (radius <= 0?)'
    };
  }
  if (computedPct === null) {
    return {
      deviceMomentPct: devicePct,
      computedUtilPct: null,
      divergencePct: null,
      isDivergent: false,
      status: 'invalid',
      reason: 'Computed utilisation unavailable (radius > jib or capacity error)'
    };
  }

  const divergence = Math.abs(devicePct - computedPct);
  const isDivergent = divergence > threshold;

  return {
    deviceMomentPct: devicePct,
    computedUtilPct: computedPct,
    divergencePct: divergence,
    isDivergent,
    status: isDivergent ? 'divergent' : 'agree',
    reason: ''
  };
}

/**
 * Formats a percentage value for display.
 * @param {number|null} val
 * @param {number} decimals
 * @returns {string}
 */
function formatPct(val, decimals = 1) {
  if (val === null || !isFinite(val)) return '—';
  return val.toFixed(decimals) + '%';
}

/**
 * Gets CSS class for divergence status badge.
 * @param {string} status - 'agree' | 'divergent' | 'invalid'
 * @returns {string}
 */
function getStatusClass(status) {
  switch (status) {
    case 'agree': return 'div-ok';
    case 'divergent': return 'div-bad';
    default: return 'div-invalid';
  }
}

/**
 * Gets human-readable status text.
 * @param {string} status
 * @returns {string}
 */
function getStatusText(status) {
  switch (status) {
    case 'agree': return 'AGREE';
    case 'divergent': return 'DIVERGENT';
    default: return 'UNAVAILABLE';
  }
}

// Expose API (works in browser and Node.js)
const globalObj = (typeof window !== 'undefined') ? window : global;
globalObj.DivergenceAPI = {
  computeDivergence,
  computeDeviceMomentPct,
  computeUtilisation,
  formatPct,
  getStatusClass,
  getStatusText,
  DEFAULT_THRESHOLD_PCT,
  REFERENCE_MOMENT
};

})();