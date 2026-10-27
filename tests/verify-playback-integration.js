// verify-playback-integration.js — Cycle 3 playback/validation wiring checks.
// Run from repo root:  node tests/verify-playback-integration.js
// No dependencies. Reads the real script.js parser, scans the supplied CSV,
// and checks the static wiring. The CSV is never modified.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const scriptPath = path.join(rootDir, 'script.js');
const index = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');

let failures = [];
let passes = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (cond) passes++; else failures.push(msg);
}

const TV = require(path.join(rootDir, 'telemetry-validation.js'));
vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'capacity.js'), 'utf8'), { filename: 'capacity.js' });
vm.runInThisContext(fs.readFileSync(path.join(rootDir, 'divergence.js'), 'utf8'), { filename: 'divergence.js' });
const DivergenceAPI = global.DivergenceAPI || (global.window && global.window.DivergenceAPI);
const csvCandidates = [
  path.join(rootDir, 'tower-telemetry-2026-09-15.csv'),
  path.join(rootDir, 'docs', 'reference', 'tower-telemetry-2026-09-15.csv'),
];
const csvPath = csvCandidates.find(function (p) { return fs.existsSync(p); });
if (!csvPath) throw new Error('supplied CSV not found');

console.log('Playback/validation integration checks:');
console.log('  CSV: ' + path.relative(rootDir, csvPath));

// 1. Extract and execute the real parseTelemetryCSV from script.js.
const start = script.indexOf('function parseTelemetryCSV');
const end = script.indexOf('\nfunction applyTelemetryRow', start);
check(start !== -1 && end !== -1, '1a. parseTelemetryCSV found in script.js');
const parserSource = script.slice(start, end);
const constStart = script.indexOf('const RATE_LIMITS');
const constEnd = script.indexOf('const T = {', constStart);
const validateStart = script.indexOf('function validateTelemetryRow', constStart);
const validateEnd = script.indexOf('\nfunction computeResumePosition', validateStart);
const helpersStart = script.indexOf('function recordRejection', validateStart);
const parserDeps = script.slice(constStart, constEnd) + '\n' +
  script.slice(validateStart, validateEnd) + '\n' +
  script.slice(helpersStart, start);
const T = { rows: [], onRowParsed: null, onInvalidRow: null, validationStore: null };
const sandbox = { T: T, TelemetryValidation: TV, isFinite: isFinite, isNaN: isNaN, console: console, Error: Error };
vm.createContext(sandbox);
vm.runInContext(parserDeps + '\n' + parserSource + '\nthis.parseTelemetryCSV = parseTelemetryCSV;', sandbox,
  { filename: 'script.js#parseTelemetryCSV' });
const rows = sandbox.parseTelemetryCSV(fs.readFileSync(csvPath, 'utf8'));
check(rows.length === 46797, '1b. parser returns 46,797 playable rows (2 chronology rejects + 1 legacy reject omitted; got ' + rows.length + ')');
const counts = T.validationStore.getCounts();
check(counts.total === 46800 && counts.accepted === 46493 && counts.rejected === 307 && counts.warnings === 143,
  '1c. parser attaches dataset validation: 46800 / 46493 accepted / 307 rejected / 143 warnings');
check(counts.byRule.checkMotionConsistency === 1,
  '1d. dataset includes one motion-bit consistency warning');
const loss = T.validationStore.getLossSummary();
check(loss.episodes === 5 && loss.samples === 304 && loss.longestSamples === 300 &&
  loss.recovered === 5 && loss.active === false && loss.withheld === 3,
  '1e. loss summary: 5 playback episodes / 304 samples / longest 300 / 3 withheld pre-playback');
const dropout = T.validationStore.getLossEpisodes().filter(function (ep) { return ep.startLine === 16382; })[0];
check(dropout && dropout.endLine === 16681 && dropout.samples === 300 &&
  dropout.byRule.checkRadiusRange === 300 && dropout.byRule.checkHookHeightRange === 300 &&
  dropout.recoveryLine === 16682,
  '1f. 300-row dropout lines 16382–16681 is exactly one episode, recovered at line 16682');
const acceptedRows = rows.filter(function (row) { return row.validation && row.validation.valid; });
let divergentRows = 0;
let comparableRows = 0;
acceptedRows.forEach(function (row) {
  const result = DivergenceAPI.computeDivergence(row, {
    jibLen: 30, windKmh: row.wind_kmh, thresholdPct: 5
  });
  if (result.status === 'divergent') divergentRows++;
  if (result.status === 'agree' || result.status === 'divergent') comparableRows++;
});
check(acceptedRows.length === 46493 && comparableRows === 46493 && divergentRows === 2428 &&
  (divergentRows / comparableRows * 100).toFixed(2) === '5.22',
  '1g. divergence share: 2,428 DIVERGENT / 46,493 accepted playable rows = 5.22%');

// 2. Consume the actual parsed rows through a playback session with a fake
// state applier. Rejected rows must never reach the applier.
const applied = [];
let warned = 0;
const session = TV.createPlaybackSession({
  onAccept: function (row) { applied.push(row); },
  onWarn: function () { warned++; },
});
rows.forEach(function (row) { session.consume(row); });
const appliedLines = new Set(applied.map(function (r) { return r.csvLine; }));
const rejectedLines = [5653, 7962, 14285, 42933];
check(applied.length === 46493 && session.getStats().rejected === 304,
  '2a. session applies 46,493 rows and holds 304 rejects');
check(rejectedLines.every(function (l) { return !appliedLines.has(l); }),
  '2b. known impossible/missing rows (5653, 7962, 14285, 42933) never reach the state applier');
check(appliedLines.has(5654) && appliedLines.has(14286) && appliedLines.has(16682) &&
  !appliedLines.has(28944) && !appliedLines.has(33589),
  '2c. WARN rows after dropouts still apply; duplicate/backwards rows are withheld in source order');
check(session.getLastAccepted() && session.getLastAccepted().csvLine === 46801,
  '2d. last accepted row is the final CSV row (line 46801, header included)');
check(warned === 143 && appliedLines.has(19218),
  '2e. motion-bit WARN row at line 19218 is still applied (one new dataset warning)');

// 3. Static wiring checks: integration points exist and teammate features remain.
check(index.indexOf('telemetry-validation.js') !== -1 &&
  index.indexOf('telemetry-validation.js') < index.indexOf('script.js'),
  '3a. index.html loads telemetry-validation.js before script.js');
check(/if \(!row \|\| \(row\.validation && !row\.validation\.valid\)\) return false;/.test(script),
  '3b. applyTelemetryRow has a rejected-row guard (defence in depth)');
check(script.indexOf('TelemetryValidation.createPlaybackSession') !== -1 &&
  script.indexOf('session.consume(row)') !== -1,
  '3c. playback consumes rows through TelemetryValidation.createPlaybackSession');
check(script.indexOf('window.TelemetryAPI.getValidationState()') !== -1 &&
  script.indexOf('T.validationStore, document, T.lastValidation || null, validationState') !== -1,
  '3d. data-quality panel receives loss summary through TelemetryAPI.getValidationState()');
check(script.indexOf('row.tsMs = vres.timestampMs') !== -1 &&
  script.indexOf('T.rows[T.rowIndex].tsMs <= targetTsMs') !== -1,
  '3e. timestamp-based playback clock preserved (tsMs drives row consumption)');
check(script.indexOf("if (T.mode === 'live') setMode('manual');") !== -1,
  '3f. slider interaction still switches LIVE -> MANUAL');
check(/if \(T\.mode === 'live'\) \{\s+resumePlayback\(\);/.test(script) &&
  /if \(T\.mode === 'live'\) \{\s+pausePlayback\(\);/.test(script),
  '3g. LIVE play/pause transport preserved');
check(script.indexOf('DivergenceAPI.computeDivergence') !== -1 &&
  script.indexOf('thresholdPct: 5') !== -1,
  '3h. divergence badge/computation and 5 pp threshold preserved');
check(script.indexOf('getCurrentTelemetryRow') !== -1 &&
  script.indexOf('updateDivergenceBadge()') !== -1,
  '3i. divergence UI hook preserved');
check(script.indexOf('T.validationStore.getCounts()') !== -1,
  '3j. TelemetryAPI exposes validation counters for diagnostics');

// 4. Counter idempotence across replay: the store is populated at load time,
// and consuming the same rows again does not mutate counters.
const beforeReplay = T.validationStore.getCounts();
const beforeLoss = T.validationStore.getLossSummary();
rows.forEach(function (row) { session.consume(row); });
const afterReplay = T.validationStore.getCounts();
const afterLoss = T.validationStore.getLossSummary();
check(JSON.stringify(beforeReplay) === JSON.stringify(afterReplay) &&
  JSON.stringify(beforeLoss) === JSON.stringify(afterLoss),
  '4a. replaying parsed rows does not change dataset counters or loss episodes');

console.log(failures.length
  ? ('\nRESULT: FAIL (' + failures.length + ' check(s) failed, ' + passes + ' passed)')
  : ('\nRESULT: ALL CHECKS PASSED (' + passes + ' checks)'));
process.exit(failures.length ? 1 : 0);
