// verify-motion-consistency.js — Cycle 3 motion-bit cross-channel checks.
// Run from repo root:  node tests/verify-motion-consistency.js
// No dependencies. Uses synthetic rows only; the supplied CSV is not modified.
'use strict';
const path = require('path');
const TV = require(path.join(__dirname, '..', 'telemetry-validation.js'));

let failures = [];
let passes = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (cond) passes++; else failures.push(msg);
}
function mk(over) {
  return TV.parseRow(Object.assign({
    ts: '2026-09-15T06:00:00+05:30', imei: '000000000000001',
    load_t: '1.00', radius_m: '20.00', slew_deg: '45.0',
    hook_height_m: '24.00', wind_kmh: '8.0', moment_pct: '24.7',
    status_word: '0', event: '',
  }, over || {}));
}
function row(sec, over) {
  return mk(Object.assign({ ts: '2026-09-15T06:00:0' + sec + '+05:30' }, over || {}));
}
function hasMotion(res) {
  return res.findings.some(function (f) { return f.rule === 'checkMotionConsistency'; });
}
function motionWarn(res) {
  return res.valid === true && res.severity === 'warn' && hasMotion(res);
}

console.log('Motion-bit consistency checks:');

// 1. Bit says movement; measured position does not move for two intervals.
var still = TV.validateRow(
  row('2', { status_word: '1', hook_height_m: '24.00' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.00' }),
    prev2: row('0', { status_word: '1', hook_height_m: '24.00' }) }
);
check(motionWarn(still), '1. hoist bit ON for two intervals with no hook movement -> WARN');

var stillTrolley = TV.validateRow(
  row('2', { status_word: '2', radius_m: '20.00' }),
  { prev: row('1', { status_word: '2', radius_m: '20.00' }),
    prev2: row('0', { status_word: '2', radius_m: '20.00' }) }
);
check(motionWarn(stillTrolley), '1b. trolley bit ON for two intervals with no radius movement -> WARN');

var stillSlew = TV.validateRow(
  row('2', { status_word: '4', slew_deg: '45.0' }),
  { prev: row('1', { status_word: '4', slew_deg: '45.0' }),
    prev2: row('0', { status_word: '4', slew_deg: '45.0' }) }
);
check(motionWarn(stillSlew), '1c. slew bit ON for two intervals with no slew movement -> WARN');

// 2. Bit says no movement; measured position moves for two intervals.
var moveHoist = TV.validateRow(
  row('2', { status_word: '0', hook_height_m: '25.40' }),
  { prev: row('1', { status_word: '0', hook_height_m: '24.70' }),
    prev2: row('0', { status_word: '0', hook_height_m: '24.00' }) }
);
check(motionWarn(moveHoist), '2. hoist bit OFF for two moving intervals -> WARN');

var moveTrolley = TV.validateRow(
  row('2', { status_word: '0', radius_m: '21.10' }),
  { prev: row('1', { status_word: '0', radius_m: '20.55' }),
    prev2: row('0', { status_word: '0', radius_m: '20.00' }) }
);
check(motionWarn(moveTrolley), '2b. trolley bit OFF for two moving intervals -> WARN');

var moveSlew = TV.validateRow(
  row('2', { status_word: '0', slew_deg: '18.0' }),
  { prev: row('1', { status_word: '0', slew_deg: '14.0' }),
    prev2: row('0', { status_word: '0', slew_deg: '10.0' }) }
);
check(motionWarn(moveSlew), '2c. slew bit OFF for two moving intervals -> WARN');

// 3. Normal movement with the corresponding bit ON is not flagged.
var normalHoist = TV.validateRow(
  row('2', { status_word: '1', hook_height_m: '25.40' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.70' }),
    prev2: row('0', { status_word: '1', hook_height_m: '24.00' }) }
);
check(normalHoist.valid === true && normalHoist.severity === 'ok' && !hasMotion(normalHoist),
  '3. normal hoist movement with hoist bit ON -> no motion warning');

var normalTrolley = TV.validateRow(
  row('2', { status_word: '2', radius_m: '21.10' }),
  { prev: row('1', { status_word: '2', radius_m: '20.55' }),
    prev2: row('0', { status_word: '2', radius_m: '20.00' }) }
);
check(normalTrolley.valid === true && normalTrolley.severity === 'ok' && !hasMotion(normalTrolley),
  '3b. normal trolley movement with trolley bit ON -> no motion warning');

var normalSlew = TV.validateRow(
  row('2', { status_word: '4', slew_deg: '18.0' }),
  { prev: row('1', { status_word: '4', slew_deg: '14.0' }),
    prev2: row('0', { status_word: '4', slew_deg: '10.0' }) }
);
check(normalSlew.valid === true && normalSlew.severity === 'ok' && !hasMotion(normalSlew),
  '3c. normal slew movement with slew bit ON -> no motion warning');

// 4. Wrap-aware slew movement: +179 -> -179 is 2 degrees, not 358.
var wrapMove = TV.validateRow(
  row('2', { status_word: '0', slew_deg: '-175.0' }),
  { prev: row('1', { status_word: '0', slew_deg: '-179.0' }),
    prev2: row('0', { status_word: '0', slew_deg: '179.0' }) }
);
check(motionWarn(wrapMove), '4. wrap-aware slew movement with slew bit OFF -> WARN');

var wrapNormal = TV.validateRow(
  row('2', { status_word: '4', slew_deg: '-175.0' }),
  { prev: row('1', { status_word: '4', slew_deg: '-179.0' }),
    prev2: row('0', { status_word: '4', slew_deg: '179.0' }) }
);
check(wrapNormal.valid === true && wrapNormal.severity === 'ok' && !hasMotion(wrapNormal),
  '4b. wrap-aware slew movement with slew bit ON -> no motion warning');

// 5. A single contradictory interval is tolerated (debounce).
var singleStop = TV.validateRow(
  row('2', { status_word: '4', slew_deg: '14.4' }),
  { prev: row('1', { status_word: '4', slew_deg: '14.0' }),
    prev2: row('0', { status_word: '4', slew_deg: '10.0' }) }
);
check(singleStop.valid === true && singleStop.severity === 'ok' && !hasMotion(singleStop),
  '5. first slew interval after movement with a 0.4 degree change -> no warning');

var singleMove = TV.validateRow(
  row('2', { status_word: '0', radius_m: '20.55' }),
  { prev: row('1', { status_word: '0', radius_m: '20.00' }),
    prev2: row('0', { status_word: '0', radius_m: '20.00' }) }
);
check(singleMove.valid === true && singleMove.severity === 'ok' && !hasMotion(singleMove),
  '5b. one moving interval with trolley bit OFF -> no warning yet');

// 6. Legitimate start and stop transitions.
var start = TV.validateRow(
  row('2', { status_word: '1', hook_height_m: '25.40' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.70' }),
    prev2: row('0', { status_word: '0', hook_height_m: '24.00' }) }
);
check(start.valid === true && start.severity === 'ok' && !hasMotion(start),
  '6. legitimate hoist start (bit OFF then ON with movement) -> no warning');

var stop = TV.validateRow(
  row('2', { status_word: '0', hook_height_m: '24.70' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.70' }),
    prev2: row('0', { status_word: '1', hook_height_m: '24.00' }) }
);
check(stop.valid === true && stop.severity === 'ok' && !hasMotion(stop),
  '6b. legitimate hoist stop (bit ON then OFF, last interval still) -> no warning');

var stationary = TV.validateRow(
  row('2', { status_word: '0' }),
  { prev: row('1', { status_word: '0' }), prev2: row('0', { status_word: '0' }) }
);
check(stationary.valid === true && stationary.severity === 'ok' && !hasMotion(stationary),
  '6c. normal stationary period with all motor bits OFF -> no warning');

// 7. Missing/invalid bit values are auxiliary warnings, not motion findings.
var badBit = TV.validateRow(
  row('2', { status_word: '', hook_height_m: '24.00' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.00' }),
    prev2: row('0', { status_word: '1', hook_height_m: '24.00' }) }
);
check(badBit.valid === true && badBit.severity === 'warn' && !hasMotion(badBit) &&
  badBit.findings.some(function (f) { return f.rule === 'checkAuxiliaryFields'; }),
  '7. missing status_word -> auxiliary WARN only, no motion finding');

var outOfMask = TV.validateRow(
  row('2', { status_word: '99999', hook_height_m: '24.00' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.00' }),
    prev2: row('0', { status_word: '1', hook_height_m: '24.00' }) }
);
check(outOfMask.valid === true && outOfMask.severity === 'warn' && !hasMotion(outOfMask) &&
  outOfMask.findings.some(function (f) { return f.rule === 'checkAuxiliaryFields'; }),
  '7b. out-of-mask status_word -> auxiliary WARN only, no motion finding');

// 8. Invalid dropout values do not create secondary motion warnings.
var afterDropout = TV.validateRow(
  row('2', { status_word: '1', hook_height_m: '24.00' }),
  { prev: row('1', { status_word: '1', hook_height_m: '24.00' }),
    prev2: row('0', { status_word: '1', hook_height_m: '-1.80' }) }
);
check(afterDropout.valid === true && afterDropout.severity === 'ok' && !hasMotion(afterDropout),
  '8. out-of-range previous hook sample is skipped, not turned into a motion warning');

// 9. Store integration threads prev2 and counts one warning for one row.
var store = TV.createStore();
store.handle(row('0', { status_word: '0', radius_m: '20.00' }), { rowId: 'M1' });
store.handle(row('1', { status_word: '0', radius_m: '20.55' }), { rowId: 'M2' });
var storeRes = store.handle(row('2', { status_word: '0', radius_m: '21.10' }), { rowId: 'M3' });
var counts = store.getCounts();
check(storeRes.valid === true && storeRes.severity === 'warn' && hasMotion(storeRes) &&
  counts.total === 3 && counts.accepted === 3 && counts.rejected === 0 &&
  counts.warnings === 1 && counts.byRule.checkMotionConsistency === 1,
  '9. store threads prev2 and counts one motion warning on the second moving interval');

console.log(failures.length
  ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed, ' + passes + ' passed)')
  : ('\nRESULT: ALL CHECKS PASSED (' + passes + ' checks)'));
process.exit(failures.length ? 1 : 0);
