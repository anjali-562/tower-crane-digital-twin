// verify-validation.js — Cycle 3 telemetry-validation unit + dataset tests.
// No dependencies. Run from repo root:  node tests/verify-validation.js
// Uses synthetic test objects plus a read-only scan of the supplied CSV.
// The CSV is never modified. Exits non-zero on any failure.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'telemetry-validation.js'), 'utf8'),
  { filename: 'telemetry-validation.js' });
const TV = vm.runInThisContext('TelemetryValidation');

let failures = [];
let passes = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (cond) passes++; else failures.push(msg);
}
function mkRow(over) {
  return TV.parseRow(Object.assign({
    ts: '2026-09-15T06:00:00+05:30', imei: '000000000000001',
    load_t: '1.00', radius_m: '20.00', slew_deg: '45.0',
    hook_height_m: '24.00', wind_kmh: '8.0', moment_pct: '24.7',
    status_word: '0', event: '',
  }, over || {}));
}
function hasRule(res, rule) { return res.reasons.some((r) => r.indexOf(rule) === 0); }
function hasRuleSeverity(res, rule, sev) {
  return res.findings.some((f) => f.rule === rule && f.severity === sev);
}
function gitBlobHash(buf) {
  return crypto.createHash('sha1')
    .update('blob ' + buf.length + '\0')
    .update(buf)
    .digest('hex');
}

console.log('telemetry-validation checks (synthetic rows + read-only dataset scan):');

// 1. Normal valid row
var ok = TV.validateRow(mkRow(), {});
check(ok.valid === true && ok.severity === 'ok' && ok.reasons.length === 0, '1. normal valid row -> valid/ok, no reasons');
check(typeof mkRow().imei === 'string' && mkRow().imei === '000000000000001', '1b. imei kept as string (leading zeros preserved)');

// 2. Missing / malformed required and auxiliary fields
var miss = TV.validateRow(mkRow({ load_t: '' }), {});
check(miss.valid === false && hasRule(miss, 'checkFiniteValues'), '2a. missing load_t -> reject by checkFiniteValues (not zero)');
var missWind = TV.validateRow(mkRow({ wind_kmh: '' }), {});
check(missWind.valid === false && hasRule(missWind, 'checkFiniteValues'), '2b. missing wind_kmh -> reject (required for capacity derate)');
var missMoment = TV.validateRow(mkRow({ moment_pct: '' }), {});
check(missMoment.valid === true && missMoment.severity === 'warn' && hasRule(missMoment, 'checkAuxiliaryFields'),
  '2c. missing moment_pct -> warn only (divergence unavailable, motion still valid)');
var badStatus = TV.validateRow(mkRow({ status_word: 'not-an-int' }), {});
check(badStatus.valid === true && badStatus.severity === 'warn' && hasRule(badStatus, 'checkAuxiliaryFields'),
  '2d. non-numeric status_word -> warn only');
var badEvent = TV.validateRow(mkRow({ event: 'SOMETHING_ELSE' }), {});
check(badEvent.valid === true && badEvent.severity === 'warn' && hasRule(badEvent, 'checkAuxiliaryFields'),
  '2e. undocumented event label -> warn only');

// 3. NaN / infinity / non-numeric in required fields
var nan = TV.validateRow(mkRow({ radius_m: 'NaN' }), {});
check(nan.valid === false && hasRule(nan, 'checkFiniteValues'), '3a. NaN radius_m -> reject by checkFiniteValues');
var inf = TV.validateRow(mkRow({ hook_height_m: 'Infinity' }), {});
check(inf.valid === false && hasRule(inf, 'checkFiniteValues'), '3b. Infinity hook -> reject by checkFiniteValues');
var text = TV.validateRow(mkRow({ slew_deg: 'east' }), {});
check(text.valid === false && hasRule(text, 'checkFiniteValues'), '3c. non-numeric slew -> reject by checkFiniteValues');

// 4. Load range (asymmetric documented noise floor)
var neg = TV.validateRow(mkRow({ load_t: '-0.70' }), {});
check(neg.valid === false && hasRule(neg, 'checkLoadRange'), '4a. load -0.70 t -> reject by checkLoadRange');
var bNeg = TV.validateRow(mkRow({ load_t: '-0.021' }), {});
check(bNeg.valid === false && hasRule(bNeg, 'checkLoadRange'), '4b. load -0.021 t (past noise floor) -> reject');
var bEdge = TV.validateRow(mkRow({ load_t: '-0.020' }), {});
check(bEdge.valid === true && bEdge.severity === 'ok', '4c. load -0.020 t (noise-floor edge) -> valid/ok');
var zero = TV.validateRow(mkRow({ load_t: '0' }), {});
check(zero.valid === true && zero.severity === 'ok', '4d. load 0 t (unloaded hook) -> valid/ok');
var atMax = TV.validateRow(mkRow({ load_t: '5' }), {});
check(atMax.valid === true && atMax.severity === 'ok', '4e. load 5 t (rated maximum) -> valid/ok');
var justOver = TV.validateRow(mkRow({ load_t: '5.001' }), {});
check(justOver.valid === false && hasRule(justOver, 'checkLoadRange'), '4f. load 5.001 t (above maximum) -> reject');
var negWind = TV.validateRow(mkRow({ wind_kmh: '-1' }), {});
check(negWind.valid === false && hasRule(negWind, 'checkWindRange'), '4g. negative wind -> reject by checkWindRange (40 km/h stays an alert, not a validity cap)');

// 5. Radius range (documented ~4–29 m, never clamped)
var rLo = TV.validateRow(mkRow({ radius_m: '3.50' }), {});
check(rLo.valid === false && hasRule(rLo, 'checkRadiusRange'), '5a. radius 3.50 m -> reject by checkRadiusRange');
var rHi = TV.validateRow(mkRow({ radius_m: '33.40' }), {});
check(rHi.valid === false && hasRule(rHi, 'checkRadiusRange'), '5b. radius 33.40 m -> reject by checkRadiusRange');
var rZero = TV.validateRow(mkRow({ radius_m: '0.00', hook_height_m: '0.00' }), {});
check(rZero.valid === false && hasRule(rZero, 'checkRadiusRange'), '5c. radius 0.00 m -> reject (no clamp, no zero special case)');
var rMinEdge = TV.validateRow(mkRow({ radius_m: '4.00' }), {});
check(rMinEdge.valid === true && rMinEdge.severity === 'ok', '5d. radius 4.00 m (range edge) -> valid/ok');
var rMaxEdge = TV.validateRow(mkRow({ radius_m: '29.00' }), {});
check(rMaxEdge.valid === true && rMaxEdge.severity === 'ok', '5e. radius 29.00 m (range edge) -> valid/ok');
var rJustOut = TV.validateRow(mkRow({ radius_m: '3.99' }), {});
check(rJustOut.valid === false && hasRule(rJustOut, 'checkRadiusRange'), '5f. radius 3.99 m (just outside) -> reject');

// 6. Hook height range
var hLo = TV.validateRow(mkRow({ hook_height_m: '-1.80' }), {});
check(hLo.valid === false && hasRule(hLo, 'checkHookHeightRange'), '6a. hook -1.80 m -> reject by checkHookHeightRange');
var hHi = TV.validateRow(mkRow({ hook_height_m: '47.00' }), {});
check(hHi.valid === false && hasRule(hHi, 'checkHookHeightRange'), '6b. hook 47.00 m -> reject by checkHookHeightRange');

// 7. Slew range and wraparound
var wrap = TV.validateRow(mkRow({ slew_deg: '-179.0' }), { prev: mkRow({ slew_deg: '179.0' }) });
check(wrap.valid === true && wrap.severity === 'ok' && !hasRule(wrap, 'checkPhysicalJump'),
  '7a. wraparound +179 -> -179 -> valid/ok, no false jump warning');
var over1 = TV.validateRow(mkRow({ slew_deg: '180.1' }), {});
check(over1.valid === true && over1.severity === 'warn' && hasRule(over1, 'checkSlewRange'), '7b. slew 180.1 (small overshoot) -> warn only');
var overBig = TV.validateRow(mkRow({ slew_deg: '185.0' }), {});
check(overBig.valid === false && hasRule(overBig, 'checkSlewRange'), '7c. slew 185.0 (genuine invalid) -> reject');

// 8. Timestamp strictness / ordering
var badTs = TV.validateRow(mkRow({ ts: 'not-a-time' }), {});
check(badTs.valid === false && hasRule(badTs, 'checkTimestamp'), '8a. unparseable ts -> reject by checkTimestamp');
var noOffset = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:00' }), {});
check(noOffset.valid === false && hasRule(noOffset, 'checkTimestamp'), '8b. timestamp without offset -> reject (browser zone never assumed)');
var badDate = TV.validateRow(mkRow({ ts: '2026-02-30T06:00:00+05:30' }), {});
check(badDate.valid === false && hasRule(badDate, 'checkTimestamp'), '8c. impossible calendar date -> reject');
var dupTs = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:00+05:30' }),
  { seen: { '2026-09-15T06:00:00+05:30': true }, lastMs: Date.parse('2026-09-15T06:00:01+05:30') });
check(dupTs.valid === true && dupTs.severity === 'warn' && hasRule(dupTs, 'checkTimestamp'), '8d. duplicate ts -> warn only');
var dupInstant = TV.validateRow(mkRow({ ts: '2026-09-15T00:30:00Z' }),
  { seen: { ['@' + Date.parse('2026-09-15T06:00:00+05:30')]: true } });
check(dupInstant.valid === true && dupInstant.severity === 'warn' && hasRule(dupInstant, 'checkTimestamp'),
  '8e. same instant in another offset -> duplicate warn');
var ooo = TV.validateRow(mkRow({ ts: '2026-09-15T05:59:59+05:30' }),
  { lastMs: Date.parse('2026-09-15T06:00:00+05:30') });
check(ooo.valid === true && ooo.severity === 'warn' && hasRule(ooo, 'checkTimestamp'), '8f. out-of-order ts -> warn only');
var a = Date.parse('2026-09-15T06:00:00+05:30'), b = Date.parse('2026-09-15T00:30:00Z');
check(a === b, '8g. +05:30 offset honoured: 06:00+05:30 === 00:30Z');

// 9. Physical-jump heuristic: WARN only and scaled by elapsed time
var jump = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:01+05:30', radius_m: '20.00' }),
  { prev: mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '9.60' }) });
check(jump.valid === true && jump.severity === 'warn' && hasRule(jump, 'checkPhysicalJump'),
  '9a. 10.4 m radius change in 1 s -> warn, stays valid');
var jumpSlow = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:05+05:30', radius_m: '20.00' }),
  { prev: mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '9.60' }) });
check(jumpSlow.severity === 'ok' && !hasRule(jumpSlow, 'checkPhysicalJump'),
  '9b. same 10.4 m change in 5 s (2.08 m/s) -> no warning (elapsed time used)');
var slewFast = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:01+05:30', slew_deg: '45.0' }),
  { prev: mkRow({ ts: '2026-09-15T06:00:00+05:30', slew_deg: '30.0' }) });
check(slewFast.severity === 'warn' && hasRule(slewFast, 'checkPhysicalJump'), '9c. 15° slew in 1 s -> warn');
var slewSlow = TV.validateRow(mkRow({ ts: '2026-09-15T06:00:03+05:30', slew_deg: '45.0' }),
  { prev: mkRow({ ts: '2026-09-15T06:00:00+05:30', slew_deg: '30.0' }) });
check(slewSlow.severity === 'ok' && !hasRule(slewSlow, 'checkPhysicalJump'), '9d. same 15° slew in 3 s (5 °/s) -> no warning');

// 10. Store: hold last good, warnings, counters, stable row IDs
var store = TV.createStore();
store.handle(mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '20.00' }), { rowId: 'T1' });
var goodBefore = store.getLastGood();
store.handle(mkRow({ ts: '2026-09-15T06:00:01+05:30', radius_m: '33.40' }), { rowId: 'T2' });
var goodAfter = store.getLastGood();
check(goodBefore && goodAfter && goodAfter.radius_m === 20 &&
  store.getLastResult().action === 'reject-hold',
  '10a. rejected row holds last good state (radius still 20.00, action=reject-hold)');
store.handle(mkRow({ ts: '2026-09-15T06:00:02+05:30', slew_deg: '180.1' }), { rowId: 'T3' });
check(store.getLastResult().action === 'accept-warn' && store.getLastResult().valid === true,
  '10b. warning row is accepted for playback (action=accept-warn, valid=true)');
var c1 = store.getCounts();
check(c1.total === 3 && c1.accepted === 2 && c1.rejected === 1 && c1.held === 1 && c1.warnings === 1,
  '10c. counters: total=3 accepted=2 rejected=1 held=1 warnings=1 (got ' + JSON.stringify(c1) + ')');
check(c1.byRule.checkRadiusRange === 1 && c1.reasonHits.checkRadiusRange === 1,
  '10d. byRule/reasonHits count the radius rejection once');
store.handle(mkRow({ ts: '2026-09-15T06:00:01+05:30', radius_m: '33.40' }), { rowId: 'T2' });
store.handle(mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '20.00' }), { rowId: 'T1' });
var c2 = store.getCounts();
check(store.getLastResult().counted === false && c2.total === c1.total && c2.rejected === c1.rejected &&
  c2.recent === undefined && store.getRecent().length === 2,
  '10e. repeated rowId revalidates for display but does not double-count or duplicate recent');
var multi = TV.createStore();
multi.handle(mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '20.00' }), { rowId: 'M1' });
multi.handle(mkRow({ ts: '2026-09-15T06:00:01+05:30', radius_m: '33.40', hook_height_m: '47' }), { rowId: 'M2' });
var mc = multi.getCounts();
check(mc.total === 2 && mc.rejected === 1 && mc.byRule.checkRadiusRange === 1 &&
  mc.byRule.checkHookHeightRange === 1 && mc.reasonHits.checkRadiusRange === 1 &&
  mc.reasonHits.checkHookHeightRange === 1,
  '10f. one row with multiple rules counts once per rule, not once per reason');

// 11. Playback session: rejected rows never reach apply; warnings do
var sessionRows = [
  mkRow({ ts: '2026-09-15T06:00:00+05:30', radius_m: '20.00' }),
  mkRow({ ts: '2026-09-15T06:00:01+05:30', slew_deg: '180.1' }),
  mkRow({ ts: '2026-09-15T06:00:02+05:30', radius_m: '33.40' }),
];
var sessStore = TV.createStore();
sessionRows.forEach(function (r, i) { r.validation = sessStore.handle(r, { rowId: 'S' + (i + 1) }); });
var applied = [];
var rejected = 0;
var warned = 0;
var session = TV.createPlaybackSession({
  onAccept: function (row) { applied.push(row); },
  onWarn: function () { warned++; },
  onReject: function () { rejected++; },
});
sessionRows.forEach(function (r) { session.consume(r); });
check(applied.length === 2 && rejected === 1 && warned === 1,
  '11a. session applies OK+WARN rows, rejects the impossible row (applied=2, rejected=1, warned=1)');
check(session.getLastAccepted() === sessionRows[1] && session.getStats().rejected === 1,
  '11b. rejected row does not replace last accepted row');

// 11c. Optional dashboard hook writes the counters/current badge into the
// documented element IDs without requiring a real browser DOM.
var uiStore = TV.createStore();
uiStore.handle(mkRow({ ts: '2026-09-15T06:00:00+05:30' }), { rowId: 'U1' });
uiStore.handle(mkRow({ ts: '2026-09-15T06:00:01+05:30', slew_deg: '180.1' }), { rowId: 'U2' });
uiStore.handle(mkRow({ ts: '2026-09-15T06:00:02+05:30', radius_m: '33.40' }), { rowId: 'U3' });
var uiEls = {};
['dqTotal', 'dqAccepted', 'dqRejected', 'dqWarnings', 'dqHeld', 'dqCurrent',
  'dqCurrentBadge', 'dqLastReason', 'dqRuleBreakdown'].forEach(function (id) {
  uiEls[id] = { textContent: '', className: '' };
});
uiEls.dqRecent = {
  children: [],
  get firstChild() { return this.children.length ? this.children[0] : null; },
  appendChild: function (li) { this.children.push(li); },
  removeChild: function () { this.children.shift(); },
};
var fakeDoc = {
  getElementById: function (id) { return uiEls[id] || null; },
  createElement: function (tag) { return { tagName: tag, textContent: '' }; },
};
var rendered = TV.renderCounterPanel(uiStore, fakeDoc, uiStore.getLastResult());
check(rendered === true &&
  uiEls.dqTotal.textContent === '3' &&
  uiEls.dqAccepted.textContent === '2' &&
  uiEls.dqRejected.textContent === '1' &&
  uiEls.dqWarnings.textContent === '1' &&
  uiEls.dqHeld.textContent === '1',
  '11c. counter panel renders total/accepted/rejected/warnings/held');
check(uiEls.dqCurrentBadge.textContent === 'REJECT' &&
  uiEls.dqCurrentBadge.className.indexOf('dq-reject') !== -1 &&
  uiEls.dqLastReason.textContent.indexOf('checkRadiusRange') !== -1,
  '11d. current-sample badge/reason shows REJECT and the triggered rule');
check(uiEls.dqRecent.children.length === 2,
  '11e. recent-anomaly list shows the two non-OK rows');

// 12. Full dataset scan (read-only)
var csvCandidates = [
  path.join(rootDir, 'tower-telemetry-2026-09-15.csv'),
  path.join(rootDir, 'docs', 'reference', 'tower-telemetry-2026-09-15.csv'),
];
var csvPath = csvCandidates.find(function (p) { return fs.existsSync(p); });
if (!csvPath) throw new Error('supplied CSV not found in repo root or docs/reference');
var csvBuf = fs.readFileSync(csvPath);
// Git stores the blob with LF line endings; a Windows checkout may be CRLF.
var csvCanonical = Buffer.from(csvBuf.toString('binary').replace(/\r\n/g, '\n'), 'binary');
check(gitBlobHash(csvCanonical) === '96e7df3036eb58ec15e1e13de2695a31fc2289a9',
  '12a. supplied CSV unchanged (canonical LF git blob SHA-1 matches recorded hash)');

var csv = csvBuf.toString('utf8').split(/\r?\n/);
var s2 = TV.createStore();
var firstRejects = [];
var catSpike = 0, catMissing = 0, catDropout = 0, accZeroLoad = 0;
var warnSlew = 0, warnJump = 0, warnTs = 0;
var lineMap = {};
for (var i = 1; i < csv.length; i++) {
  var line = csv[i];
  if (!line.trim()) continue;
  var p = line.split(',');
  var row = TV.parseRow({
    ts: p[0], imei: p[1], load_t: p[2], radius_m: p[3], slew_deg: p[4],
    hook_height_m: p[5], wind_kmh: p[6], moment_pct: p[7], status_word: p[8], event: p[9],
  });
  row.csvLine = i + 1;
  row.raw = line;
  row._columnCount = p.length;
  var res = s2.handle(row, { rowId: 'L' + (i + 1) });
  lineMap[i + 1] = res;
  if (!res.valid && firstRejects.length < 3) firstRejects.push({ line: i + 1, ts: p[0], reasons: res.reasons });
  if (!res.valid) {
    if (p[2] === '') catMissing++;
    else if (p[3] === '0.00') catDropout++;
    else catSpike++;
  } else if (p[2] === '0.00') accZeroLoad++;
  if (res.severity === 'warn') {
    var rules = res.findings.map(function (f) { return f.rule; });
    if (rules.indexOf('checkSlewRange') !== -1) warnSlew++;
    else if (rules.indexOf('checkPhysicalJump') !== -1) warnJump++;
    else if (rules.indexOf('checkTimestamp') !== -1) warnTs++;
  }
}
var totals = s2.getCounts();
check(firstRejects.length === 3, '12b. exactly three first hard rejections collected');
check(firstRejects[0] && firstRejects[0].line === 5653 && firstRejects[0].ts === '2026-09-15T07:34:11+05:30' &&
  firstRejects[0].reasons.some(function (r) { return r.indexOf('checkRadiusRange') === 0; }),
  '12c. 1st reject line 5653 ts=2026-09-15T07:34:11+05:30 radius 33.40 by checkRadiusRange');
check(firstRejects[1] && firstRejects[1].line === 7962 && firstRejects[1].ts === '2026-09-15T08:12:40+05:30' &&
  firstRejects[1].reasons.some(function (r) { return r.indexOf('checkLoadRange') === 0; }),
  '12d. 2nd reject line 7962 ts=2026-09-15T08:12:40+05:30 load -0.70 by checkLoadRange');
check(firstRejects[2] && firstRejects[2].line === 14285 && firstRejects[2].ts === '2026-09-15T09:58:03+05:30' &&
  firstRejects[2].reasons.some(function (r) { return r.indexOf('checkHookHeightRange') === 0; }),
  '12e. 3rd reject line 14285 ts=2026-09-15T09:58:03+05:30 hook -1.80 by checkHookHeightRange');
check(catSpike === 3 && catMissing === 1 && catDropout === 300,
  '12f. reject categories row-exclusive: spikes=' + catSpike + ' missing=' + catMissing + ' dropout=' + catDropout);
check(totals.total === 46800 && totals.accepted === 46496 && totals.rejected === 304 &&
  totals.held === 304 && totals.warnings === 144,
  '12g. full-file totals: 46800 / 46496 accepted / 304 rejected / 304 held / 144 warnings (got ' + JSON.stringify(totals) + ')');
check(totals.byRule.checkRadiusRange === 301 && totals.byRule.checkHookHeightRange === 301 &&
  totals.byRule.checkSlewRange === 139 && totals.byRule.checkLoadRange === 1 &&
  totals.byRule.checkFiniteValues === 1 && totals.byRule.checkTimestamp === 2 &&
  totals.byRule.checkPhysicalJump === 6,
  '12h. byRule row counts match the dataset (overlaps counted once per rule)');
check(totals.reasonHits.checkPhysicalJump === 8 && totals.reasonHits.checkTimestamp === 3,
  '12i. reasonHits distinguishes individual reasons from affected rows');
check(warnSlew === 139 && warnJump === 3 && warnTs === 2,
  '12j. warning rows by category: slew=139 jump=3 timestamp=2 (total 144)');
check(lineMap[42933] && lineMap[42933].valid === false &&
  lineMap[42933].findings.some(function (f) { return f.rule === 'checkFiniteValues'; }),
  '12k. line 42933 missing load_t -> rejected, not defaulted to 0');
check(lineMap[16382] && lineMap[16382].valid === false && lineMap[16681] && lineMap[16681].valid === false &&
  lineMap[16682] && lineMap[16682].valid === true,
  '12l. suspected dropout block lines 16382–16681 rejected; line 16682 accepted again');
check(lineMap[28914] && lineMap[28914].valid === true &&
  lineMap[28944] && lineMap[28944].severity === 'warn' &&
  lineMap[28944].findings.some(function (f) { return /duplicate/.test(f.message); }) &&
  lineMap[28944].findings.some(function (f) { return /out of order/.test(f.message); }),
  '12m. line 28944 is both a duplicate instant and out of order; first occurrence line 28914 is OK');
check(lineMap[33588] && lineMap[33588].valid === true &&
  lineMap[33589] && lineMap[33589].severity === 'warn' &&
  lineMap[33589].findings.some(function (f) { return /duplicate/.test(f.message); }),
  '12n. line 33589 duplicate timestamp -> warn; line 33588 first occurrence is OK');
check(accZeroLoad === 39595,
  '12o. zero load alone is accepted: ' + accZeroLoad + ' accepted rows read exactly 0.00 t');

console.log(failures.length
  ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed, ' + passes + ' passed)')
  : ('\nRESULT: ALL CHECKS PASSED (' + passes + ' checks)'));
process.exit(failures.length ? 1 : 0);
