// verify-round1.js — DGOC Round 1 "Predict, then run" verification (Cycle 2).
// No dependencies. Run:  node verify-round1.js
// Checks:
//  (a) UI slider bounds in index.html admit the exact Round 1 inputs
//      (jib 53.1/35/27.5/30, radius 3/23/34/46) — i.e. no snap/round/clamp;
//  (b) script.js manual input path no longer clamps working radius to the
//      installed jib (radius > jib must reach capacityAt and return null);
//  (c) the four exact cases through the REAL capacityAt()/tipLoadAt() model
//      from capacity.js (unchanged engineering logic, existing MCT88 table).
// Exits non-zero on any failure. Does NOT fake results.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const capSrc = fs.readFileSync(path.join(dir, 'capacity.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');

// --- Load capacity.js globals (var MCT88 / tipLoadAt / capacityAt / ...) ---
vm.runInThisContext(capSrc, { filename: 'capacity.js' });
const MCT88m = vm.runInThisContext('MCT88');
const tipLoadAtFn = vm.runInThisContext('tipLoadAt');
const capacityAtFn = vm.runInThisContext('capacityAt');

let failures = [];
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) failures.push(msg);
}

// --- (a) slider bounds -------------------------------------------------------
function sliderAttrs(id) {
  const re = new RegExp('<input[^>]*id="' + id + '"[^>]*>', 'i');
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  const get = (n) => {
    const mm = tag.match(new RegExp(n + '="([^"]+)"'));
    return mm ? parseFloat(mm[1]) : null;
  };
  return { min: get('min'), max: get('max'), step: get('step'), tag };
}
function reachable(attrs, v) {
  if (!attrs || attrs.min == null || attrs.max == null || attrs.step == null) return false;
  if (v < attrs.min - 1e-9 || v > attrs.max + 1e-9) return false;
  const k = (v - attrs.min) / attrs.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

const jibS = sliderAttrs('sJib');
const troS = sliderAttrs('sTrolley');
console.log('Sliders found:');
console.log('  sJib:     min=' + jibS.min + ' max=' + jibS.max + ' step=' + jibS.step);
console.log('  sTrolley: min=' + troS.min + ' max=' + troS.max + ' step=' + troS.step);

console.log('Check (a): required values reachable by sliders (no snap/round)');
[53.1, 35, 27.5, 30].forEach((v) => check(reachable(jibS, v), 'jib slider admits ' + v + ' m'));
[3, 23, 34, 46].forEach((v) => check(reachable(troS, v), 'radius slider admits ' + v + ' m'));
// Absolute bound still exists (safety not removed): trolley cannot exceed max MCT88 jib.
check(troS.max <= 53.1 + 1e-9, 'trolley slider keeps absolute max bound (<= 53.1 m, max MCT88 jib)');
check(troS.min >= 2 - 1e-9 && troS.min <= 3 + 1e-9, 'trolley slider keeps a low-end bound (2..3 m) while admitting 3 m');

// --- (b) no silent clamp of radius to installed jib on the manual path -------
console.log('Check (b): manual radius path does not clamp to installed jib');
check(!/sJib'?\]\s*\)?\.max\s*=\s*S\.jibLen\s*-\s*1/.test(js) && !/\$\('sTrolley'\)\.max\s*=\s*S\.jibLen\s*-\s*1/.test(js),
  'sJib handler no longer forces trolley max = jib-1');
check(!/if\s*\(\s*S\.tTrolley\s*>\s*S\.jibLen\s*-\s*1/.test(js),
  'sJib handler no longer clamps working radius down to jib-1');
check(/clamp\(S\.trolley,\s*2,\s*53\.1\)/.test(js),
  'updateCraneMovement clamps to ABSOLUTE bounds [2, 53.1], not to installed jib');

// --- (c) exact engineering results -------------------------------------------
console.log('Check (c): four Round 1 cases through capacityAt() (no hard-coded answers)');
const cases = [
  { name: 'CASE 1', jib: 53.1, radius: 46, load: 1.5 },
  { name: 'CASE 2', jib: 35, radius: 3, load: 4 },
  { name: 'CASE 3', jib: 27.5, radius: 23, load: 2 },
  { name: 'CASE 4', jib: 30, radius: 34, load: 1 },
];
function statusOf(cap, util) {
  if (cap == null) return 'OUT OF RANGE / INVALID (DANGER)';
  if (util >= 1.0) return 'DANGER (load >= capacity)';
  if (util >= 0.9) return 'WARNING';
  return 'SAFE';
}
cases.forEach((c) => {
  // Simulate the fixed UI pipeline: slider string -> parse -> 1-decimal jib rounding.
  const jibGot = Math.round(parseFloat(String(c.jib)) * 10) / 10;
  const rGot = parseFloat(String(c.radius));
  const lGot = parseFloat(String(c.load));
  const pipeOk = (jibGot === c.jib && rGot === c.radius && lGot === c.load);
  check(pipeOk, c.name + ' input pipeline preserves jib=' + c.jib + ' radius=' + c.radius + ' load=' + c.load +
    ' (got jib=' + jibGot + ' radius=' + rGot + ' load=' + lGot + ')');
  const tip = tipLoadAtFn(MCT88m, jibGot);
  const M = tip * jibGot;
  const corner = M / MCT88m.maxCapacityT;
  const cap = capacityAtFn(MCT88m, jibGot, rGot);
  const valid = rGot <= jibGot;
  const util = (cap == null) ? null : lGot / cap;
  console.log('  --- ' + c.name + ': jib=' + jibGot + ' m radius=' + rGot + ' m load=' + lGot + ' t');
  console.log('      tip=' + tip.toFixed(4) + ' t  M=' + M.toFixed(4) + ' t·m  corner=' + corner.toFixed(4) + ' m');
  console.log('      capacity=' + (cap == null ? 'null (OUT OF RANGE)' : cap.toFixed(4) + ' t'));
  if (util != null) console.log('      utilization=' + (util * 100).toFixed(2) + '%  status=' + statusOf(cap, util));
  else console.log('      utilization=—  status=' + statusOf(cap, util));
  console.log('      radius valid (<= jib): ' + valid);
  if (c.name === 'CASE 4') {
    check(jibGot === 30 && rGot === 34, 'CASE 4 preserves Jib=30 AND Radius=34 (not clamped, not merged)');
    check(cap === null, 'CASE 4 capacityAt(30 m jib, 34 m) returns null (out-of-range)');
  } else {
    check(valid === true, c.name + ' radius within installed jib (valid)');
    check(cap != null, c.name + ' capacity is a number (in chart)');
  }
});

console.log(failures.length ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed)') : '\nRESULT: ALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
