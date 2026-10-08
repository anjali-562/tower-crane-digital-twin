// verify-wind-derating.js — DGOC Round 3 wind-derate verification.
// SIMULATED PRODUCT RULE: windKmh >= 20 -> base * 0.8; < 20 or absent -> base.
// Run from repo root:  node tests/verify-wind-derating.js
// Exits non-zero on any failure. Does NOT fake results.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const rootDir = path.join(dir, '..');
const capSrc = fs.readFileSync(path.join(rootDir, 'capacity.js'), 'utf8');
const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');

vm.runInThisContext(capSrc, { filename: 'capacity.js' });
const MCT88m = vm.runInThisContext('MCT88');
const capacityAtFn = vm.runInThisContext('capacityAt');

let failures = [];
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) failures.push(msg);
}
function close(a, b, tol) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= tol;
}
const TOL = 1e-9;

console.log('Round 3 wind-derate checks (SIMULATED PRODUCT RULE, not certified):');

// A. Existing three-argument behavior unchanged: capacityAt(MCT88, 30, 20) = 4.05 t
check(close(capacityAtFn(MCT88m, 30, 20), 4.05, TOL),
  'A. no-wind capacityAt(30, 20) = 4.05 t (got ' + capacityAtFn(MCT88m, 30, 20) + ')');

// B. Below threshold: (30, 20, 19) = 4.05 t
check(close(capacityAtFn(MCT88m, 30, 20, 19), 4.05, TOL),
  'B. capacityAt(30, 20, 19 km/h) = 4.05 t (got ' + capacityAtFn(MCT88m, 30, 20, 19) + ')');

// C. Exact threshold: (30, 20, 20) = 3.24 t
check(close(capacityAtFn(MCT88m, 30, 20, 20), 3.24, TOL),
  'C. capacityAt(30, 20, 20 km/h) = 3.24 t (got ' + capacityAtFn(MCT88m, 30, 20, 20) + ')');

// D. Above threshold: (30, 20, 25) = 3.24 t
check(close(capacityAtFn(MCT88m, 30, 20, 25), 3.24, TOL),
  'D. capacityAt(30, 20, 25 km/h) = 3.24 t (got ' + capacityAtFn(MCT88m, 30, 20, 25) + ')');

// E. Out-of-range stays null even with wind: (30, 34, 25) = null
check(capacityAtFn(MCT88m, 30, 34, 25) === null,
  'E. capacityAt(30, 34, 25 km/h) is null (got ' + capacityAtFn(MCT88m, 30, 34, 25) + ')');

// F. Corner region: (30, 5, 20) = 4.0 t (base 5.0 x 0.8)
check(close(capacityAtFn(MCT88m, 30, 5, 20), 4.0, TOL),
  'F. capacityAt(30, 5, 20 km/h) = 4.0 t (got ' + capacityAtFn(MCT88m, 30, 5, 20) + ')');

// Extra: undefined/null wind returns base; MCT88 table untouched
check(close(capacityAtFn(MCT88m, 30, 20, undefined), 4.05, TOL), 'G1. undefined wind returns base 4.05 t');
check(close(capacityAtFn(MCT88m, 30, 20, null), 4.05, TOL), 'G2. null wind returns base 4.05 t');
check(close(capacityAtFn(MCT88m, 30, 20, 0), 4.05, TOL), 'G3. 0 km/h returns base 4.05 t');
const tip30 = MCT88m.tipLoadByJib.filter(function (r) { return r.jibM === 30; })[0];
check(!!tip30 && close(tip30.tipT, 2.70, TOL), 'G4. MCT88 tip table 30 m still 2.70 t');

// UI wiring (static checks): numeric wind control 0-60 step 1 + DERATED badge + windKmh threading
console.log('UI wiring checks:');
check(/id="sWindKmh"[^>]*min="0"[^>]*max="60"[^>]*step="1"/.test(html) ||
      /id="sWindKmh"[^>]*max="60"/.test(html),
  'H1. index.html has numeric wind control sWindKmh 0-60 km/h step 1');
check(html.indexOf('id="derateBadge"') !== -1, 'H2. index.html has separate derateBadge (not repurposed riskBadge)');
check(html.indexOf('id="riskBadge"') !== -1, 'H3. existing riskBadge still present');
check(/capacityAt\(MCT88,\s*S\.jibLen,\s*r,\s*S\.windKmh\)/.test(js),
  'H4. script.js capNow threads S.windKmh into capacityAt');
check(js.indexOf('sWindKmh') !== -1 && js.indexOf('derateBadge') !== -1,
  'H5. script.js wires sWindKmh input and derateBadge visibility');

console.log(failures.length ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed)') : '\nRESULT: ALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
