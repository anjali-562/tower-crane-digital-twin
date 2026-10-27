# Telemetry Validation Report — Tower Crane Digital Twin

**Date:** 2026-10-27
**Branch:** `main` (commit `b2ad8b4`)
**Auditor:** Senior TypeScript Engineer / Repository Maintainer

---

## 1. Test Execution Summary

All test suites pass on the updated `main` branch:

| Test Suite | Checks | Status |
|------------|--------|--------|
| `verify-round1.js` | 25 | ✅ ALL PASSED |
| `verify-wind-derating.js` | 22 | ✅ ALL PASSED |
| `verify-divergence.js` | 45 | ✅ ALL PASSED |
| `verify-validation.js` | 65 | ✅ ALL PASSED |
| `verify-playback-integration.js` | 18 | ✅ ALL PASSED |
| `verify-cycle3-audit.js` | 11 | ✅ ALL PASSED |
| `verify-cycle3-audit2.js` | 14 | ✅ ALL PASSED |
| `verify-cycle3-audit3.js` | 19 | ✅ ALL PASSED |
| **Total** | **219** | **✅ ALL PASSED** |

### Syntax Checks
```bash
node --check script.js        # PASS
node --check capacity.js      # PASS
node --check divergence.js    # PASS
node --check telemetry-validation.js  # PASS
```

---

## 2. Requirement Verification

### Requirement A: Transmitted-Value Regression Test
**Status:** ✅ IMPLEMENTED AND VERIFIED

- **Implementation:** `divergence.js:34-40` — `computeDeviceMomentPct()` uses `row.moment_pct` directly
- **Tests:** `verify-cycle3-audit.js` (11 checks), `verify-cycle3-audit2.js` (14 checks)
- **Verification:** Device moment % uses transmitted value as-is; independent change to transmitted value changes divergence result

### Requirement B: Motion-Bit Consistency & Reverse-Direction Checks
**Status:** ✅ IMPLEMENTED AND VERIFIED

#### Motion-Bit Consistency (`checkMotionBitConsistency`)
- **WARN** when motion bit (hoist/trolley/slew) set but measured change below tolerance (0.05 m / 0.1°)
- **WARN** when measured movement present but motion bit not set
- **REJECT** when conflicting limit switches active (lsHookUp+lsHookDown, lsTrolleyOut+lsTrolleyIn)
- **Tolerances:** `MOTION_TOLERANCE = { radiusM: 0.05, hookM: 0.05, slewDeg: 0.1 }` — **SIMULATION HEURISTICS**

#### Reverse-Direction (`checkReverseDirection`)
- Compares motion bit direction (via limit switches) with measured rate-based direction
- **Hoist:** lsHookUp (up) vs lsHookDown (down) vs measured hook rate
- **Trolley:** lsTrolleyOut (out) vs lsTrolleyIn (in) vs measured radius rate
- **Slew:** No dedicated limit switch bits in schema — skipped
- **Tolerances:** `REVERSE_TOLERANCE = { radiusMps: 0.1, hookMps: 0.1, slewDps: 0.5 }` — **SIMULATION HEURISTICS**
- **Thresholds:** Only triggers when rate exceeds tolerance to avoid sensor noise

#### Rate Limits
- **Documented as:** Configurable simulation heuristics, NOT certified crane limits
- **Source:** Derived from largest anomaly-free 1-second changes in supplied CSV
- **No manufacturer speed limits** supplied in project sources

### Requirement C: Loss Event Grouping
**Status:** ✅ IMPLEMENTED AND VERIFIED

- **Implementation:** In `createStore()` — tracks consecutive REJECT rows
- **New loss event starts when:**
  1. First REJECT row encountered
  2. Gap > `LOSS_EVENT_MIN_GAP_MS` (2000 ms) between consecutive REJECT rows
  3. Valid (OK/WARN) row breaks the consecutive REJECT sequence
- **Loss event fields:** `startTs`, `endTs`, `startLine`, `endLine`, `rowCount`, `firstReason`, `reasons[]`
- **Access:** `store.getLossEvents(n)` returns recent loss events
- **Dataset result:** 300-row frozen dropout (lines 16382–16681) now grouped into **1 loss event** instead of 300 individual REJECTs

### Requirement D: ~5% Divergent Rows Explanation
**Status:** ✅ VERIFIED WITH DATA

- **Dataset:** 46,800 rows (`docs/reference/tower-telemetry-2026-09-15.csv`)
- **Valid rows analyzed:** 46,498 (radius ≤ 30 m jib, all finite values)
- **Divergent rows (>5 pp):** 2,429
- **Divergence rate:** **5.22%**
- **Primary causes:**
  1. **Inside corner radius (r < 16.2 m):** Device formula `load×radius/81×100` vs model's max-capacity-limited utilisation (5 t)
  2. **Wind derating (≥20 km/h):** Device moment_pct unchanged, model utilisation increases due to 0.8× capacity
  3. **Sensor noise/transmission differences**
- **Documented in:** README.md "Device vs computed utilisation" section

### Requirement E: Documentation Review
**Status:** ✅ UPDATED

- Removed misleading "real calculation" wording
- Added explicit ~5.22% divergence rate with data source
- Documented motion-bit consistency and reverse-direction checks as implemented
- Documented loss event grouping as implemented
- Added auto jib suggestion (`suggestJib`) to features
- Updated full-dataset results with new warning counts (1,327 module / 1,325 merged)
- Updated limitations section

---

## 3. New Features Implemented

### Auto Jib Suggestion (`suggestJib`)
- **Location:** `capacity.js:83-107`
- **Function:** Returns shortest installed jib from table that can carry `loadT` at `radiusM` with 15% safety margin (`loadT <= capacity * 0.85`)
- **UI Integration:** Lift Planner shows "SUGGESTED JIB" hint after CHECK LIFT
- **Ported from:** `round3-auto-jib` branch (commit `c604133`)

### Motion-Bit Consistency & Reverse-Direction
- **Location:** `telemetry-validation.js` (new check functions)
- **Exports:** `checkMotionBitConsistency`, `checkReverseDirection`, `MOTION_TOLERANCE`, `REVERSE_TOLERANCE`, `STATUS_BITS`, `LOSS_EVENT_MIN_GAP_MS`
- **Integration:** Added to `validateRow()` check chain

### Loss Event Grouping
- **Location:** `telemetry-validation.js` in `createStore()`
- **Export:** `getLossEvents(n)` method on store
- **Tracks:** Consecutive REJECT rows with start/end timestamps, line numbers, row count

---

## 4. Full-Dataset Validation Results

### Module-Level Scan (`telemetry-validation.js` only)
| Metric | Count |
|--------|-------|
| Rows validated | 46,800 |
| Accepted | 46,496 |
| Rejected / held last good | 304 |
| **Warnings** | **1,327** |
| Zero-load rows accepted | 39,595 |

### Merged Parser/Playback (app runtime)
| Metric | Count |
|--------|-------|
| Rows validated | 46,800 |
| Playable rows in source order | 46,797 |
| Applied / accepted | 46,493 |
| Final rejected / held | 307 |
| **Warnings** | **1,325** |

### Rejected Rows by Category
| Category | Rows | Lines | Primary Rule |
|----------|------|-------|--------------|
| Single-sample spikes | 3 | 5653, 7962, 14285 | `checkRadiusRange`, `checkLoadRange`, `checkHookHeightRange` |
| Missing telemetry | 1 | 42933 | `checkFiniteValues` |
| Suspected sensor dropout | 300 | 16382–16681 | `checkRadiusRange` + `checkHookHeightRange` |
| Duplicate + backwards timestamp | 1 | 28944 | Chronology + cross-channel |
| Duplicate timestamp | 1 | 33589 | Chronology |
| Cross-channel contradiction | 1 | 24671 | Overload bit with low moment/load |

### Warning Breakdown (Module-Level)
| Rule | Rows | Reasons |
|------|------|---------|
| `checkMotionBitConsistency` | 1,210 | 1,214 |
| `checkSlewRange` | 139 | 139 |
| `checkPhysicalJump` | 6 | 8 |
| `checkTimestamp` | 2 | 3 |
| `checkReverseDirection` | 0 | 0 |

---

## 5. Divergence Analysis Details

### Methodology
- Compared transmitted `moment_pct` vs computed `load_t / capacityAt(MCT88, 30, radius_m, wind_kmh) × 100`
- Threshold: 5 percentage points
- Only rows with radius ≤ 30 m (installed jib) and all finite values included

### Results
| Metric | Value |
|--------|-------|
| Total valid rows | 46,498 |
| Divergent rows (>5 pp) | 2,429 |
| **Divergence rate** | **5.22%** |

### Divergence Causes
1. **Inside corner radius (41.3% of divergent):** Device formula assumes linear `load×radius` relationship; model caps at 5 t max capacity
2. **Wind derating (32.1% of divergent):** Device moment_pct doesn't account for 0.8× capacity derate at ≥20 km/h
3. **Outside corner, no wind (26.6% of divergent):** Minor differences from interpolation, sensor noise

---

## 6. Clock and LIVE Rejoin Verification

### Clock Behavior (`telemetryTick`)
- Timestamp-driven: `targetTsMs = startTsMs + (nowMs - startWallMs) × speed`
- Rejected rows advance clock pointer but don't update crane state
- STALE state after 5,000 ms without accepted sample (`STALE_AFTER_MS`)

### LIVE Rejoin (`computeResumePosition`)
- **Scenario:** MANUAL → LIVE after pause/slider interaction
- **Behavior:** Resumes at first row with `tsMs > lastAcceptedTsMs`
- **No replay:** Does NOT restart at row 0 or replay older rows
- **At end of stream:** Marks `complete=true`, `stale=true`, holds last accepted sample
- **Tests:** `verify-cycle3-audit.js` (11 checks), `verify-cycle3-audit2.js` (14 checks), `verify-cycle3-audit3.js` (19 checks) — ALL PASS

---

## 7. Files Changed

### New Files
- `docs/telemetry-branch-audit.md` — Branch audit documentation
- `docs/telemetry-validation-report.md` — This report

### Modified Files
| File | Changes |
|------|---------|
| `telemetry-validation.js` | Added `checkMotionBitConsistency`, `checkReverseDirection`, loss event grouping in `createStore()`, new constants (`STATUS_BITS`, `MOTION_TOLERANCE`, `REVERSE_TOLERANCE`, `LOSS_EVENT_MIN_GAP_MS`) |
| `capacity.js` | Added `suggestJib()` function |
| `index.html` | Added "SUGGESTED JIB" hint UI in Lift Planner |
| `script.js` | Integrated `suggestJib()` call in `checkLift()` |
| `README.md` | Updated divergence explanation, named checks table, full-dataset results, limitations |
| `tests/verify-validation.js` | Updated expected warning counts, added `mkRowWithMotion` helper |
| `tests/verify-playback-integration.js` | Updated expected warning counts (1,325) |

### Preserved (Untracked, Not Modified)
- `R3-chatTranscript.md`
- `cycle3-checkin.mp4`
- `cycle3-namya-divergence-ui.patch`
- `cycle3-puja-telemetry-playback.patch`
- `round3-auto-jib.patch`

---

## 8. Browser Console Evidence

**Note:** Browser console screenshot not captured in this headless environment. To capture manually:

1. Serve the repository: `npx serve .` or `python -m http.server 8000`
2. Open `http://localhost:8000` in Chrome/Edge
3. Open DevTools (F12) → Console
4. Load `tower-telemetry-2026-09-15.csv` via "LOAD TELEMETRY CSV"
5. Switch to LIVE mode
6. Observe:
   - No errors/warnings on load
   - Divergence badge updates with transmitted vs computed values
   - Validation panel shows counters updating
   - STALE/COMPLETE states on playback end/loss
   - Lift Planner shows "SUGGESTED JIB" after CHECK LIFT

---

## 9. Unresolved Issues

| Issue | Reason |
|-------|--------|
| Motion-bit tolerances are simulation heuristics | No manufacturer-certified limits in project sources |
| Reverse-direction slew check skipped | No documented slew limit switch bits in DRM 3400 schema |
| Loss event gap threshold (2s) is configurable | No certified telemetry-loss definition available |
| Divergence rate ~5.22% is dataset-specific | Synthetic dataset; not a universal crane characteristic |

---

## 10. Final Status

| Metric | Value |
|--------|-------|
| **Current branch** | `main` |
| **Main commit** | `b2ad8b4` (Merge PR #4) |
| **Uncommitted changes** | None (all committed) |
| **Untracked files preserved** | 5 (chat transcript, video, patches) |
| **All tests passing** | ✅ YES (219/219) |
| **Requirements implemented** | ✅ A, B, C, D, E |
| **Documentation updated** | ✅ YES |

---

**Planning aid, not a certified lift plan.**