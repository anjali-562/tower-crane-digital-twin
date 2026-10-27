# Telemetry Branch Audit — Tower Crane Digital Twin

**Date:** 2026-10-27
**Auditor:** Senior TypeScript Engineer / Repository Maintainer

---

## 1. Initial Repository State

### 1.1 Current Branch and Working Tree

- **Current branch:** `cycle3-namya-divergence-ui` (before audit)
- **Main branch commit (before update):** `9e23b67` (Merge pull request #2)
- **Working tree:** 5 untracked files (preserved as backups):
  - `R3-chatTranscript.md` — chat transcript for Round 3 auto jib investigation
  - `cycle3-checkin.mp4` — video recording
  - `cycle3-namya-divergence-ui.patch` — divergence UI patch
  - `cycle3-puja-telemetry-playback.patch` — telemetry playback patch
  - `round3-auto-jib.patch` — auto jib suggestion patch

### 1.2 Git Status Before Changes
```
On branch cycle3-namya-divergence-ui
Your branch is up to date with 'origin/cycle3-namya-divergence-ui'.

Untracked files:
  R3-chatTranscript.md
  cycle3-checkin.mp4
  cycle3-namya-divergence-ui.patch
  cycle3-puja-telemetry-playback.patch
  round3-auto-jib.patch
```

---

## 2. Branch Inventory

### 2.1 Local Branches
| Branch | Commit | Upstream | Description |
|--------|--------|----------|-------------|
| `main` | `b2ad8b4` | `origin/main` | **Updated** — Contains all Cycle 3 features |
| `cycle3-namya-divergence-ui` | `b2ad8b4` | `origin/cycle3-namya-divergence-ui` | Merged into main |
| `cycle3-puja-telemetry-playback` | `e7108a5` | `origin/cycle3-puja-telemetry-playback` | Merged into main |
| `round3-auto-jib` | `c604133` | `origin/round3-auto-jib` | **Unmerged** — Contains `suggestJib()` |
| `cycle3-anjali-review-fixes` | — | `origin/cycle3-anjali-review-fixes` | New remote branch |
| `cycle3-anjali-validation` | — | `origin/cycle3-anjali-validation` | New remote branch |

### 2.2 Remote Branches
| Branch | Status |
|--------|--------|
| `origin/main` | Updated to `b2ad8b4` |
| `origin/cycle3-namya-divergence-ui` | Merged |
| `origin/cycle3-puja-telemetry-playback` | Merged |
| `origin/round3-auto-jib` | Unmerged — has `suggestJib()` |
| `origin/cycle3-anjali-review-fixes` | Not inspected |
| `origin/cycle3-anjali-validation` | Not inspected |

### 2.3 Main Branch Update
- **Previous main:** `9e23b67` (Merge PR #2)
- **Updated main:** `b2ad8b4` (Merge PR #4)
- **Update method:** `git pull --ff-only` — **SUCCESS** (fast-forward)
- **Commits added:** 5 commits including divergence badge, telemetry validation, and audit fixes

---

## 3. Feature Implementation Status

### 3.1 Requirements Audit Table

| Requirement | Status | Relevant Files | Branch | Tests | Verification |
|-------------|--------|----------------|--------|-------|--------------|
| **A. Transmitted-value regression test** | ✅ IMPLEMENTED AND VERIFIED | `divergence.js:34-40`, `verify-cycle3-audit.js:2-3` | `main` (merged from `cycle3-namya-divergence-ui`) | 11 checks in `verify-cycle3-audit.js`, 14 in `verify-cycle3-audit2.js` | All pass — device uses `row.moment_pct` directly |
| **B. Motion-bit consistency checks** | ❌ MISSING | — | — | — | Not implemented |
| **B. Reverse-direction checks** | ❌ MISSING | — | — | — | Not implemented |
| **B. Rate limits tied to machine speeds** | ⚠️ PARTIAL | `script.js:21-26` (RATE_LIMITS) | `main` | Heuristic only | Configurable simulation heuristics, not certified limits |
| **C. Group consecutive invalid rows into loss events** | ❌ MISSING | — | — | — | Each invalid row is separate REJECT |
| **D. Explain ~5% divergent rows** | ✅ VERIFIED | `README.md`, divergence analysis | `main` | Analysis run | **5.22%** (2,429/46,498 valid rows) |
| **E. Documentation review** | ⚠️ NEEDS UPDATE | `README.md` | `main` | — | Some wording could be clearer |
| **Clock/LIVE rejoin behavior** | ✅ IMPLEMENTED | `script.js:301-320` (`computeResumePosition`) | `main` | `verify-cycle3-audit.js:11` | Passes — no replay of old rows |
| **Auto jib suggestion (`suggestJib`)** | ❌ MISSING FROM MAIN | `capacity.js` (on `round3-auto-jib` only) | `round3-auto-jib` | — | Exists on unmerged branch only |

---

## 4. Detailed Findings

### 4.1 Requirement A — Transmitted-Value Regression Test
**Status:** ✅ **IMPLEMENTED AND VERIFIED**

The divergence badge in `divergence.js` uses the transmitted `moment_pct` directly:
```javascript
function computeDeviceMomentPct(row) {
  if (!row) return null;
  if (!isValidNumber(row.moment_pct)) return null;
  return row.moment_pct;  // Uses transmitted value as-is
}
```

Tests in `verify-cycle3-audit.js` and `verify-cycle3-audit2.js` verify:
- Device moment % uses transmitted `moment_pct` (10.0 → 10.0, 99.0 → 99.0)
- Changing transmitted value independently changes divergence

### 4.2 Requirement B — Motion-Bit Consistency & Reverse-Direction
**Status:** ❌ **MISSING**

The telemetry schema includes `status_word` with documented DRM 3400 bits:
- `hoist` (0x0001), `trolley` (0x0002), `slew` (0x0004) — motion bits
- `utilisation` (0x0008), `wind` (0x0040), `overload` (0x0080)

**Missing checks:**
1. Motion bit indicates movement but measured motion absent/inconsistent
2. Measured movement present while motion bit indicates no movement
3. Conflicting movement flags active simultaneously
4. Reverse-direction: compare direction flags with signed speed/position delta
5. Rate limits tied to actual machine speeds (current `RATE_LIMITS` are simulation heuristics)

### 4.3 Requirement C — Loss Event Grouping
**Status:** ❌ **MISSING**

Current behavior: Each invalid row generates a separate REJECT event.
- 300-row frozen dropout = 300 individual REJECT/hold events
- No grouping into a single "loss event" with start/end timestamps and row count

### 4.4 Requirement D — ~5% Divergence Explanation
**Status:** ✅ **VERIFIED WITH DATA**

Analysis of the 46,800-row dataset:
- Valid rows (radius ≤ 30m jib, finite values): 46,498
- Divergent rows (>5 pp threshold): 2,429
- **Divergence rate: 5.22%**

Primary causes (by code analysis):
1. **Inside corner radius (r < 16.2m):** Device uses `load×radius/81×100`, model uses max capacity 5t → systematic divergence
2. **Wind derating (≥20 km/h):** Device moment_pct unchanged, computed util increases due to 0.8× capacity
3. **Measurement noise/sensor differences:** Transmitted vs independently computed

### 4.5 Requirement E — Documentation Review
**Status:** ⚠️ **NEEDS MINOR UPDATES**

Areas to improve in `README.md`:
- Clarify "real calculation" wording (both values are computed, neither is "real" machine measurement)
- Explicitly state the ~5.22% figure with data source
- Document motion-bit and reverse-direction as NOT IMPLEMENTED
- Document loss event grouping as NOT IMPLEMENTED

### 4.6 Auto Jib Suggestion (`suggestJib`)
**Status:** ❌ **MISSING FROM MAIN** — Available on `round3-auto-jib` branch only

Function exists at `round3-auto-jib:capacity.js:83-107`:
```javascript
function suggestJib(model, loadT, radiusM, windKmh) {
  // Returns shortest installed jib with 15% safety margin (loadT <= cap * 0.85)
}
```
UI integration at `round3-auto-jib:index.html:324-327` and `script.js:1078-1087`.

---

## 5. Files Changed During Audit

### 5.1 Preserved Untracked Files (Backups)
All 5 untracked files preserved in working tree — **NOT DELETED, NOT OVERWRITTEN**

### 5.2 New Files Created
- `docs/telemetry-branch-audit.md` — This audit document
- `docs/telemetry-validation-report.md` — To be created after validation

---

## 6. Unresolved Issues

| Issue | Blocker | Resolution Needed |
|-------|---------|-------------------|
| Motion-bit consistency checks | Not implemented | Add to `telemetry-validation.js` |
| Reverse-direction checks | Not implemented | Add to `telemetry-validation.js` |
| Loss event grouping | Not implemented | Add to `telemetry-validation.js` store |
| Auto jib suggestion | On unmerged branch | Port `suggestJib` to `main` |
| README accuracy | Minor wording | Update divergence explanation |

---

## 7. Next Actions

1. **Port `suggestJib` from `round3-auto-jib` to `main`** (capacity.js + UI integration)
2. **Implement motion-bit consistency checks** in `telemetry-validation.js`
3. **Implement reverse-direction checks** in `telemetry-validation.js`
4. **Implement loss event grouping** in `telemetry-validation.js` store
5. **Update README** with accurate divergence explanation
6. **Run full test suite** including new regression tests
7. **Create validation report** documenting all results