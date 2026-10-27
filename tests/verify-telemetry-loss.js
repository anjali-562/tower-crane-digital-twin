// verify-telemetry-loss.js — contiguous rejection/loss episode checks.
// Run from repo root:  node tests/verify-telemetry-loss.js
// No dependencies. Uses synthetic rows plus the real script.js stale helper.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const TV = require(path.join(rootDir, 'telemetry-validation.js'));

let failures = [];
let passes = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (cond) passes++; else failures.push(msg);
}
function ts(sec) {
  return '2026-09-15T06:00:' + String(sec).padStart(2, '0') + '+05:30';
}
function mkRow(sec, over) {
  return TV.parseRow(Object.assign({
    ts: ts(sec), imei: '000000000000001',
    load_t: '1.00', radius_m: '20.00', slew_deg: '45.0',
    hook_height_m: '24.00', wind_kmh: '8.0', moment_pct: '24.7',
    status_word: '0', event: '',
  }, over || {}));
}
function badRow(sec) {
  // Load-only rejection avoids adding a second, unrelated jump warning when
  // the synthetic run recovers to the normal radius/height.
  return mkRow(sec, { load_t: '5.50' });
}
function assignLines(rows) {
  rows.forEach(function (r, i) { r.csvLine = i + 1; });
  return rows;
}

console.log('telemetry-loss grouping checks:');

// 1. Single rejected row = one one-sample episode, then recovery.
{
  const store = TV.createStore();
  const rows = assignLines([mkRow(0), badRow(1), mkRow(2)]);
  rows.forEach(function (r, i) { r.validation = store.handle(r, { rowId: 'A' + (i + 1) }); });
  const summary = store.getLossSummary();
  const ep = store.getLossEpisodes()[0];
  check(summary.episodes === 1 && summary.samples === 1 && summary.longestSamples === 1 &&
    summary.active === false && summary.recovered === 1,
    '1a. single invalid row produces one recovered one-sample episode');
  check(ep && ep.startLine === 2 && ep.endLine === 2 && ep.recoveryLine === 3 &&
    ep.recoverySeverity === 'ok',
    '1b. episode records start/end/recovery line and recovery severity');
  check(store.getCounts().accepted === 2 && store.getCounts().rejected === 1 &&
    store.getCounts().held === 1 && store.getCounts().withheld === 0,
    '1c. per-row accepted/rejected/held counters remain unchanged');
  check(store.getRecent().length === 1 && store.getLastGood().ts === ts(2),
    '1d. per-row rejection diagnostic is retained and last-good advances after recovery');
}

// 2. Long contiguous run = one episode, active until the first valid row.
{
  const store = TV.createStore();
  const rows = assignLines([mkRow(0)]);
  for (let i = 1; i <= 20; i++) rows.push(badRow(i));
  assignLines(rows);
  rows.forEach(function (r, i) { r.validation = store.handle(r, { rowId: 'B' + (i + 1) }); });
  let summary = store.getLossSummary();
  check(summary.episodes === 1 && summary.samples === 20 && summary.longestSamples === 20 &&
    summary.active === true && summary.recovered === 0,
    '2a. 20 contiguous rejects are one active 20-sample episode');
  check(store.getCounts().rejected === 20 && store.getCounts().held === 20 &&
    store.getRecent().length === 20 && store.getCounts().byRule.checkLoadRange === 20,
    '2b. all 20 rejects remain individually counted and diagnosed');
  check(store.getLastGood().ts === ts(0),
    '2c. last-good stays at the pre-loss row while the episode is active');
  const recovery = mkRow(21);
  recovery.validation = store.handle(recovery, { rowId: 'B22' });
  summary = store.getLossSummary();
  check(summary.active === false && summary.recovered === 1 && summary.samples === 20 &&
    store.getLastGood().ts === ts(21),
    '2d. first valid row closes the episode, records recovery, and updates last-good');
}

// 3. Multiple separated runs = multiple episodes, not one giant episode.
{
  const store = TV.createStore();
  const rows = assignLines([mkRow(0), badRow(1), badRow(2), mkRow(3), badRow(4), mkRow(5)]);
  rows.forEach(function (r, i) { r.validation = store.handle(r, { rowId: 'C' + (i + 1) }); });
  const summary = store.getLossSummary();
  const eps = store.getLossEpisodes();
  check(summary.episodes === 2 && summary.samples === 3 && summary.longestSamples === 2 &&
    summary.recovered === 2 && summary.active === false,
    '3a. two separated runs produce two recovered episodes (3 samples total)');
  check(eps[0].startLine === 2 && eps[0].endLine === 3 && eps[0].samples === 2 &&
    eps[0].recoveryLine === 4 && eps[1].startLine === 5 && eps[1].endLine === 5 &&
    eps[1].recoveryLine === 6,
    '3b. episode boundaries and recoveries are distinct');
}

// 4. Playback session still consumes every row, including the rejected run.
{
  const store = TV.createStore();
  const rows = assignLines([mkRow(0), badRow(1), badRow(2), mkRow(3)]);
  rows.forEach(function (r, i) {
    r.validation = store.handle(r, { rowId: 'D' + (i + 1) });
    r.tsMs = r.validation.timestampMs;
  });
  const applied = [];
  const rejected = [];
  const session = TV.createPlaybackSession({
    onAccept: function (row) { applied.push(row); },
    onReject: function (res) { rejected.push(res); },
  });
  let consumed = 0;
  rows.forEach(function (row) { session.consume(row); consumed++; });
  check(consumed === rows.length && applied.length === 2 && rejected.length === 2,
    '4a. playback consumes all 4 rows and rejects only the two invalid samples');
  check(session.getLastAccepted() === rows[3] && session.getStats().rejected === 2,
    '4b. a rejected run does not replace last-accepted state and does not stop row consumption');
  check(rows.every(function (r) { return isFinite(r.tsMs); }),
    '4c. timestamps remain usable while loss rows are consumed');
}

// 5. Real script.js STALE helper: five-second playback-time threshold and recovery.
{
  global.TelemetryValidation = TV;
  global.window = { addEventListener: function () {} };
  global.document = {};
  global.THREE = { MathUtils: { clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); } } };
  global.performance = { now: function () { return Date.now(); } };
  vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'capacity.js'), 'utf8'), { filename: 'capacity.js' });
  vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'divergence.js'), 'utf8'), { filename: 'divergence.js' });
  try {
    vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8'), { filename: 'script.js' });
  } catch (e) { /* scene setup needs a real DOM/WebGL; TelemetryAPI is exported first */ }
  const TAPI = global.TelemetryAPI || global.window.TelemetryAPI;
  check(!!TAPI && typeof TAPI.isTelemetryStale === 'function' && TAPI.staleAfterMs === 5000,
    '5a. real TelemetryAPI stale helper and 5 s threshold are available');
  const liveState = function (lastAcceptedTsMs, complete) {
    return { mode: 'live', playing: true, rows: [{ tsMs: 1000 }], complete: !!complete, lastAcceptedTsMs: lastAcceptedTsMs };
  };
  check(TAPI.isTelemetryStale(liveState(1000, false), 6000) === false,
    '5b. exactly 5 s without a sample is not yet STALE');
  check(TAPI.isTelemetryStale(liveState(1000, false), 6001) === true,
    '5c. more than 5 s without a sample is STALE');
  check(TAPI.isTelemetryStale(liveState(7000, false), 8000) === false,
    '5d. recovery after a new accepted timestamp clears STALE');
  check(TAPI.isTelemetryStale(liveState(7000, true), 8000) === true,
    '5e. COMPLETE remains distinct and reports stale/hold state');

  // 6. Divergence display state: normal -> stale during loss -> recovery -> complete.
  const displayState = TAPI.getDivergenceDisplayState;
  check(typeof displayState === 'function',
    '6a. production divergence display-state resolver is exposed for testing');
  const divergenceState = {
    mode: 'live', rows: [{ tsMs: 1000 }], lastAcceptedRow: { tsMs: 1000 },
    stale: false, complete: false
  };
  check(displayState(divergenceState) === 'normal',
    '6b. fresh accepted playback resolves to normal comparison mode');
  divergenceState.stale = true;  // prior last-good row still retained
  check(displayState(divergenceState) === 'stale',
    '6c. loss with last-good retained resolves to STALE, not normal comparison');
  divergenceState.stale = false; // fresh accepted row
  check(displayState(divergenceState) === 'normal',
    '6d. recovery resolves back to normal comparison mode');
  divergenceState.stale = true;
  divergenceState.complete = true;
  check(displayState(divergenceState) === 'complete',
    '6e. completion takes precedence over stale and resolves to COMPLETE');
}

// 7. Parser-withheld row inside a rejection run must not split or close it.
// This uses the real parseTelemetryCSV() policy and the real store accounting.
{
  const header = 'ts,imei,load_t,radius_m,slew_deg,hook_height_m,wind_kmh,moment_pct,status_word,event';
  const csv = [
    header,
    '2026-09-15T06:00:00+05:30,000000000000001,1.00,20.00,45.0,24.00,8.0,24.7,0,',
    '2026-09-15T06:00:01+05:30,000000000000001,5.50,20.00,45.0,24.00,8.0,24.7,0,',
    '2026-09-15T06:00:01+05:30,000000000000001,1.00,20.00,45.0,24.00,8.0,24.7,0,',
    '2026-09-15T06:00:02+05:30,000000000000001,5.50,20.00,45.0,24.00,8.0,24.7,0,',
    '2026-09-15T06:00:03+05:30,000000000000001,1.00,20.00,45.0,24.00,8.0,24.7,0,'
  ].join('\n');
  const TAPI = global.TelemetryAPI || global.window.TelemetryAPI;
  const originalCreateStore = TV.createStore;
  let capturedStore = null;
  let parsed;
  let state;
  TV.createStore = function () {
    capturedStore = originalCreateStore();
    return capturedStore;
  };
  try {
    parsed = TAPI.parseTelemetryCSV(csv);
    state = TAPI.getValidationState();
  } finally {
    TV.createStore = originalCreateStore;
  }
  check(parsed.length === 4 && parsed.every(function (r) { return r.csvLine !== 4; }),
    '7a. parser withholds the duplicate row and keeps the four playable samples');
  check(state.accepted === 2 && state.rejected === 3 && state.withheld === 1,
    '7b. withheld row is counted separately from accepted/rejected playback samples');
  check(state.loss && state.loss.episodes === 1 && state.loss.samples === 2 &&
    state.loss.recovered === 1 && state.loss.active === false && state.loss.withheld === 1,
    '7c. withheld row does not split the run: one recovered episode with two rejected samples');
  const episodes = capturedStore && capturedStore.getLossEpisodes();
  check(episodes && episodes.length === 1 && episodes[0].samples === 2 &&
    episodes[0].startLine === 3 && episodes[0].endLine === 5 &&
    episodes[0].recoveryLine === 6 && episodes[0].recoverySeverity === 'ok',
    '7d. episode starts/ends on the two rejects and recovers on the next accepted sample');
}

console.log(failures.length
  ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed, ' + passes + ' passed)')
  : ('\nRESULT: ALL CHECKS PASSED (' + passes + ' checks)'));
process.exit(failures.length ? 1 : 0);
