# Tower Crane Digital Twin

A simulation-based digital twin prototype for a Potain MCT 88-class tower crane, developed to study crane operation, load-capacity behavior, safety states, and spatial constraints in a construction-site environment.

![Status](https://img.shields.io/badge/status-Cycle%203%20prototype-lightgrey)
![Stack](https://img.shields.io/badge/stack-static%20HTML%20%2B%20JS-blue)
![3D](https://img.shields.io/badge/3D-Three.js%20r128-green)

> **Scope note.** This is a software simulation and engineering-study prototype. It is **not** a certified crane planning or safety system, it does **not** use live crane sensors, and it does **not** claim real-time physical-twin synchronization. See [BIM vs simulation vs digital twin](#bim-vs-simulation-vs-digital-twin) and [Limitations](#limitations).

## Project Overview

Tower cranes lift heavy loads at long radii close to buildings, people, and other plant. Safe operation depends on knowing, at every moment, how much load the crane can carry at the current radius, whether the hook is where it is allowed to be, and whether the load path stays clear of structures.

This prototype simulates that monitoring task:

- A 3D tower crane (hoist, trolley, slew) operating on a construction site with buildings, storage areas, and exclusion zones.
- A load-moment capacity model derived from published Potain MCT 88 data, evaluated live at the current working radius.
- Decision-support behavior: SAFE / WARNING / DANGER states, out-of-range detection, exclusion-zone and building-clearance checks, and validation against published load-chart points.

Everything runs as a static HTML/JavaScript application with no build step and no backend.

## Key Features

- Interactive 3D tower crane simulation
- Hoist, trolley, and slew movement (manual control plus automatic lift demonstration)
- Configurable jib length and working radius
- Potain MCT 88-class capacity model
- Load-moment based capacity calculation
- SAFE / WARNING / DANGER risk states
- Exclusion-zone checking
- Building clearance checking
- Published-data validation
- Validation dashboard
- Automatic lift demonstration
- Timestamp-driven CSV telemetry playback with a LIVE / MANUAL override
- Device-vs-computed utilisation divergence badge (5 percentage-point tolerance)
- Telemetry validation with REJECT / hold-last-good handling, loss event grouping, and data-quality counters
- Engineering-oriented telemetry panel
- **Motion-bit consistency checks** (status_word motion bits vs measured motion)
- **Reverse-direction checks** (motion bit direction vs measured direction)
- **Loss event grouping** (consecutive invalid rows grouped into single events)
- **Auto jib suggestion** (`suggestJib()` — shortest installed jib with 15% safety margin)

## Engineering Model

Capacity follows an idealized load-moment model implemented in `capacity.js` (`capacityAt()`). The tip load for the installed jib is taken from the published MCT 88 tip-load table (interpolated between table rows where needed).

### Maximum Load Moment

```text
M_max = tip_load × jib_length
```

### Corner Radius

```text
r_corner = M_max / maximum_capacity
```

### Capacity Model

For a working radius inside the corner radius:

```text
capacity(r) = maximum_capacity
```

For a working radius beyond the corner radius (up to the installed jib length):

```text
capacity(r) = M_max / r
```

A radius beyond the installed jib length is out of range: the model returns no capacity instead of extrapolating. This is an idealized teaching model. Actual crane load charts can contain additional structural, reeving, configuration, and derating constraints, so this equation should not be mistaken for the complete manufacturer load chart.

### Wind derating (SIMULATED PRODUCT RULE — not certified)

- Threshold: 20 km/h (derate active at `windKmh >= 20`, hidden below).
- Factor: rated capacity × 0.8, applied to the final base capacity (`capacityAt(model, jibM, radiusM, windKmh)`).
- Purpose: simulated capacity derating driven by the numeric wind-speed input (0–60 km/h, 1 km/h steps).
- Status: product-requested simulation rule. The ticket cites "EN 14439 Table 7", but the available project sources do not contain that table text, so the citation is unverified (see `docs/SOURCES.md` §6).
- Certification: not a certified wind-load calculation. Cycle 2 validation remains the baseline/no-wind validation.
- UI: SAFE / WARNING / DANGER = load utilization status; DERATED = wind-based capacity reduction is active (separate indicator).

### Device vs computed utilisation (Cycle 3)

- **Device moment % (transmitted)**: the value comes directly from `row.moment_pct` as transmitted by the device. The divergence badge uses exactly this transmitted value; it is **kept as-is** and is **not** recomputed from `load_t × radius_m / 81 × 100` inside the divergence comparison. The badge explicitly labels it as transmitted.
- **Model utilisation % (capacity-based)**: computed independently via `capacityAt(MCT88, jibLen, radius_m, wind_kmh)` using the load-moment/corner-radius capacity model (5 t up to corner radius `r_corner = M/maxCapacity`, else capacity = `M/r` where `M = tipLoadAt × jibLen`). For radii beyond installed jib, capacity is unavailable (out of range) and the comparison reports **UNAVAILABLE/invalid**.
- **Corner radius / capacity**: corner radius `r_corner = M_max / maximum_capacity` (e.g. 81/5 = 16.2 m at 30 m jib). Inside corner radius capacity is limited by max capacity; outside by moment limit.
- **Simulated wind derating**: if `wind_kmh >= 20` km/h, base capacity is multiplied by 0.8 (**SIMULATED PRODUCT RULE**). This is not a certified calculation and is labeled as such in UI (DERATED indicator is separate from SAFE/WARNING/DANGER).
- **Divergence badge**: compares transmitted device moment % against model utilisation % (both in percent). Differences are reported in percentage points. The badge always uses the **last accepted/held telemetry sample** (never a rejected incoming row). When telemetry is missing/lost, it shows a clear **STALE** state rather than flooding the UI with per-row rejection messages. On playback completion it shows **COMPLETE** while still holding the last accepted sample.
- **Observed divergence rate**: analysis of the 46,800-row synthetic dataset (`docs/reference/tower-telemetry-2026-09-15.csv`) shows **~5.22% of valid rows** (2,429 of 46,498 rows with radius ≤ 30 m jib and finite values) exceed the 5 percentage-point threshold. Primary causes: (1) inside corner radius (r < 16.2 m) where device formula `load×radius/81×100` differs from model's max-capacity-limited utilisation; (2) wind derating (≥20 km/h) where device moment_pct is unchanged but model utilisation increases due to 0.8× capacity factor; (3) sensor noise and transmission differences.
- **Dataset share in the supplied file**: 2,428 of the 46,493 accepted playable rows (5.22%) compute as **DIVERGENT** at the 5 percentage-point threshold (strictly greater than 5 pp). The same 2,428 rows are divergent across all 46,800 source rows (5.19% of the source file); 303 source rows return **UNAVAILABLE** because the comparison inputs are invalid and are excluded from the 46,497 rows with a comparable value. The badge is only advanced by accepted rows, so **46,493 is the denominator used here**. The 46,497 comparable rows are the 46,493 accepted rows plus the three withheld rows and the rejected hook-height spike at line 14285; all four of those extra rows compute as AGREE, so the 2,428 DIVERGENT count is unchanged under either comparison set. This is a consistency share, not an error or failure rate; the accepted-row count/share is asserted in `tests/verify-playback-integration.js` check 1g. The two sides use different formulas: transmitted `moment_pct` is load × radius / 81 × 100, while model utilisation is load / `capacityAt(MCT88, jibLen, radius_m, wind_kmh)` × 100 (with corner-radius capacity and the simulated wind derate). The code records no per-row cause, so this README does not assign one beyond those formulas.
- **Assumptions**: status/motion bit interpretations follow **documented DRM 3400 bits** only (see `docs/reference/README-for-students.md`). Implausible rate-of-change limits and some cross-channel rules are **configurable simulation heuristics** (labeled as such in code) because exact certified limits are not present in supplied docs/tests — they are not described as manufacturer-certified. No undocumented device bit meanings or speed limits were invented. Cross-channel contradictions that are supported by documented bits produce explicit validation warnings/rejection reasons.

## Current Crane Configuration

Configuration used by the prototype and its validation:

| Parameter          | Value         |
|--------------------|---------------|
| Crane model        | Potain MCT 88 |
| Validation jib     | 30 m          |
| Maximum capacity   | 5 t           |
| Tip load at 30 m   | 2.70 t        |
| Maximum moment     | 81 t·m        |
| Corner radius      | 16.2 m        |

The simulator supports installed jib lengths across the published table range (20–53.1 m). Moving the jib slider re-derives the tip load, moment, corner radius, and capacity curve from the same model.

## Validation

Model output compared against three published MCT 88 load-chart points (30 m nominal jib). Full source detail is in [`docs/SOURCES.md`](docs/SOURCES.md) and the hand derivation in [`docs/validation-calculation.txt`](docs/validation-calculation.txt).

| Radius | Published chart | Model  | Error | Status |
|--------|-----------------|--------|-------|--------|
| 20.1 m | 3.90 t          | 4.03 t | 3.3%  | PASS   |
| 25.0 m | 2.99 t          | 3.24 t | 8.4%  | PASS   |
| 29.9 m | 2.54 t          | 2.71 t | 6.7%  | PASS   |

Worst observed error: **8.4%**
Acceptance threshold: **±10%**
Validation result: **PASS**

## Safety / Risk States

Utilization is defined as `load / allowed capacity` at the current radius, using the same thresholds in the live badge, the lift planner, and the chart:

- **SAFE:** utilization < 90%
- **WARNING:** 90% ≤ utilization < 100%
- **DANGER:** utilization ≥ 100%

An out-of-range working radius (radius beyond the installed jib) is treated as invalid/out-of-range rather than being clamped to a valid capacity. The status reports DANGER — out of range.

## Spatial Constraints

Load capacity and spatial constraints are deliberately separate checks:

- **Load capacity** is the crane/load physics model (`capacityAt()`): how much the crane may carry at a given radius.
- **Exclusion zones** are geometric checks: the live hook ground position is tested against defined zone rectangles every frame (`hookInZone()`), independent of the load moment.
- **Building clearance** is a separate simplified geometric check against building volumes, with an early-warning buffer before contact. It is not a certified clearance analysis.

A lift is therefore evaluated on three independent axes — capacity, zones, and clearance — and any one of them can hold or stop an automatic lift.

## BIM vs Simulation vs Digital Twin

### BIM

Represents the physical/site environment and construction information: geometry, layout, and placement data.

### Simulation

Models crane movement and operational behavior from inputs: hoist, trolley, slew, load, and site geometry.

### Digital Twin

Combines a digital representation with operational/physical data and continuous synchronization or feedback between the physical asset and its model.

Current project status: **simulation-based, twin-ready prototype.**

Implemented:

- digital crane representation
- operational behavior simulation
- engineering calculations
- safety decision support
- spatial checks

Not yet implemented:

- continuous live sensor synchronization
- real crane telemetry
- production-grade data ingestion
- certified operational safety logic

## Project Structure

```text
tower-crane-digital-twin/
├── index.html              # simulation entry point (also served by GitHub Pages)
├── script.js               # scene, playback, LIVE/MANUAL, integration
├── style.css
├── capacity.js             # load-moment capacity model
├── divergence.js           # Cycle 3 device-vs-computed badge
├── telemetry-validation.js # Cycle 3 validation, counters, playback session
├── ui-mirror.js
├── README.md
├── docs/
│   ├── CYCLE2_SUMMARY.md
│   ├── SOURCES.md
│   ├── validation-calculation.txt
│   └── reference/
│       ├── README-for-students.md
│       └── tower-telemetry-2026-09-15.csv   # supplied synthetic dataset
└── tests/
    ├── verify-round1.js
    ├── verify-wind-derating.js
    ├── verify-divergence.js
    ├── verify-validation.js
    ├── verify-playback-integration.js
    ├── verify-cycle3-audit.js
    ├── verify-cycle3-audit2.js
    └── verify-cycle3-audit3.js
```

The web app lives at the repository root so the GitHub Pages URL
(`https://<username>.github.io/<repository>/`) opens the simulation
directly. `README.md` stays repository documentation; `index.html`
stays the application.

## Run Locally

No build step, no dependencies to install. The 3D view loads Three.js r128 from a CDN, so an internet connection is needed for the CDN scripts; the engineering model itself (`capacity.js`) is local.

1. Clone the repository.
2. Open `index.html` in Chrome or Edge.

If opening over `file://` is unreliable in your browser, serve the folder with any simple static server instead, for example:

```bash
npx serve .
# or
python -m http.server 8000
```

then open `http://localhost:8000`.

## Validation / Testing

- **Syntax:** `node --check script.js`, `node --check capacity.js`, `node --check divergence.js`, `node --check telemetry-validation.js` (plain scripts, file:// compatible, no modules).
- **Engineering validation:** `validate(MCT88, 30, CHART30)` runs in the browser console on boot against the three published chart points above; the Validation tab renders the same comparison.
- **Round 1 scenario verification:** `node tests/verify-round1.js` checks that the four required jib/radius/load combinations reach the calculation layer without being rounded or clamped, and that a radius beyond the installed jib returns out-of-range. It also verifies the slider bounds in `index.html`.
- **Round 3 wind-derate verification:** `node tests/verify-wind-derating.js` checks the 0.8× simulated product rule (no-wind baseline, 19/20/25 km/h, corner region, out-of-range null).
- **Cycle 3 divergence verification:** `node tests/verify-divergence.js` checks agreement/divergence cases, the 5 percentage-point threshold, invalid inputs, wind derating, and formatting.
- **Cycle 3 telemetry validation:** `node tests/verify-validation.js` runs 65 checks: synthetic valid/invalid rows, REJECT/hold/WARN policy, motion-bit consistency, reverse-direction, loss event grouping, counter idempotence, panel rendering, and a read-only scan of the supplied CSV (46,800 rows).
- **Cycle 3 playback integration:** `node tests/verify-playback-integration.js` runs 18 checks against the real `parseTelemetryCSV()`: merged source-order counts, hold-last-good behaviour, loss event grouping, the 2,428 / 46,493 divergence share, session rejection, timestamp clock, and preservation of the LIVE/MANUAL and divergence wiring.
- **Cycle 3 audit regressions:** `node tests/verify-cycle3-audit.js` (11 checks), `verify-cycle3-audit2.js` (14 checks) and `verify-cycle3-audit3.js` (19 checks) cover transmitted `moment_pct`, rejection counting, stale/complete, resume without replay, and duplicate/backwards reasons.
- **Cycle 2 validation:** worst error 8.4% against the ±10% acceptance threshold — PASS (see table above).

Current test status on this branch: **all five required suites and all three Cycle 3 audit suites pass** — `verify-round1`, `verify-wind-derating`, `verify-divergence`, `verify-validation` (65/65), `verify-playback-integration` (18/18), audits 11/11, 14/14 and 19/19.

## Limitations

- Simulation only; not a certified crane safety system.
- Load capacity uses an idealized load-moment model, not the full manufacturer chart logic.
- Actual crane operation may involve additional chart, configuration, reeving, and derating constraints.
- No live physical crane sensor feed is currently connected.
- No structural dynamics model.
- No wind-load physics model (Round 3 adds a SIMULATED 0.8× product derate at ≥ 20 km/h; not a certified wind-load calculation. The categorical LOW/MODERATE/HIGH wind remains visual only).
- No certified lift planning; this prototype does not replace qualified crane operators or approved lift-planning procedures.
- Telemetry validation is a data-quality layer, not certified safety logic. Limits are guide/dataset interpretations; jump thresholds are review heuristics, not manufacturer speed limits (see Cycle 3 section).
- Motion-bit consistency and reverse-direction checks use documented DRM 3400 bits only; tolerances are simulation heuristics, not certified limits.
- Loss event grouping uses a fixed 2-second gap threshold (configurable), not a certified telemetry-loss definition.
- The 300-row frozen block is handled as 300 individual hold-last-good events (now grouped into a single loss event). The ordinary playback STALE state appears after 5 s without a new accepted sample; there is no separate per-dropout banner.
- No live physical feed in this prototype: Cycle 3 replays the supplied synthetic CSV offline.
- No production operational deployment.

## Source / References

Manufacturer and chart sources are documented in [`docs/SOURCES.md`](docs/SOURCES.md). The primary source is the official Manitowoc Potain e-catalogue (EN 14439 C25 range); per-radius validation values were read from the Potain MCT 88 data sheet (FEM 1.001-A3, "Load charts" page, 98 ft row). See that file for document codes, conversion notes, and known discrepancies.

## Cycle 3 — Telemetry validation and anomaly handling

Scope: the assigned Cycle 3 validation/anomaly module for the supplied synthetic stream
`docs/reference/tower-telemetry-2026-09-15.csv` (46,800 rows, 1 Hz, 06:00:00–18:59:59 IST).
Playback timing, the LIVE/MANUAL override and the divergence badge belong to the other Cycle 3
modules and are deliberately untouched: the validation layer decides *which* samples may move the
crane, not *when* playback advances.

Implementation:

- `telemetry-validation.js` — named checks, hold-last-good store, data-quality counters, playback session and optional counter-panel renderer. Plain script, `file://`-compatible, global `TelemetryValidation`.
- `script.js` — `parseTelemetryCSV()` validates every row at load in source order, applies the Cycle 3 chronology/cross-channel checks, and withholds the three rows that fail them; `telemetryTick()` consumes the remaining playable rows through `TelemetryValidation.createPlaybackSession()`; `applyTelemetryRow()` keeps a final `validation.valid` guard.
- `index.html` / `style.css` — "Telemetry validation (CYCLE 3)" panel with counters, current-sample badge/reason, per-rule breakdown and recent anomalies.
- `tests/verify-validation.js` and `tests/verify-playback-integration.js` — 65 + 18 checks; `tests/verify-cycle3-audit.js`, `verify-cycle3-audit2.js`, `verify-cycle3-audit3.js` add 11 + 14 + 19 focused regression checks.

### How a sample is handled

1. **Validate before the crane moves.** All 46,800 rows are validated in original device order at load time, and the result is attached to the row (`row.validation`). The store is dataset-level: counters do not change when playback revisits a row. The CSV is never sorted.
2. **Only valid rows reach the state.** The playback session calls `onAccept` for OK and WARN rows. A REJECT row never reaches `applyTelemetryRow()`, so the crane keeps its last accepted state. Cycle 3 chronology checks also hard-withhold duplicate/backwards rows and the documented-bit cross-channel contradiction before the session sees them.
3. **The clock keeps running.** `telemetryTick()` advances the timestamp-driven row pointer independently of the verdict. Rejecting a sample does not pause, stop or rewind playback; the next valid sample updates the crane normally. The three rows withheld by the parser are skipped without stretching or sorting the remaining timeline.
4. **Nothing is clamped into validity and nothing is silently zeroed.** Missing fields become `NaN` and reject; out-of-range values stay out of range and reject. The scene-bound clamps in `applyTelemetryRow()` remain as a final guard, but they are wider than the validation ranges, so accepted telemetry passes through unchanged (the only edge case is an accepted −0.02 t noise-floor reading, which the clamp displays as 0 t).
5. **A second guard.** `applyTelemetryRow()` refuses any row whose `validation.valid` is false.
6. **The panel stays visible.** Counters, the current-sample badge/reason (OK / WARN / REJECT), the per-rule breakdown and the five most recent anomalies are rendered from the store.

| Verdict | Meaning | Playback action |
|---|---|---|
| **REJECT** | Required data missing/non-finite, state outside the documented envelope, impossible timestamp, or another conclusively invalid sample | Do not update the crane; hold the last accepted state; keep the clock running; show the timestamp and reasons |
| **WARN** | Suspicious but not conclusively impossible (boundary rounding, jump heuristic) | Apply the row and keep the warning visible |
| **OK** | No findings | Apply the row |

The validation module classifies a duplicate/out-of-order timestamp as WARN, but the merged playback policy preserves the earlier Cycle 3 rule: a duplicate or backwards source timestamp is withheld and counted as a final rejection. The store counters are adjusted once so the panel matches playback.

### Loss event grouping

A **loss event** groups a contiguous run of rejected rows for the user-facing summary without discarding or merging the per-row records:

- The first fresh rejection opens an event and records its start line/timestamp.
- Each immediately following rejection increments the event's sample count and merges its rule counts. The rejected/held counters, `byRule`/`reasonHits` counts, and the capped `recent` list still count every row individually.
- The first accepted row (OK or WARN) closes the event, records the recovery line/timestamp/severity, and updates last-good. A later rejection starts a new event.
- If the file ends during a run, the event remains active; the supplied file ends with an accepted row, so all events are recovered.
- A gap of more than `LOSS_EVENT_MIN_GAP_MS` (default 2000 ms) between consecutive rejected rows also starts a new event.

In the supplied dataset the playback store reports **5 events / 304 rejected samples / longest 300**, with all 5 recovered and 0 active; the 300-row dropout at lines 16382–16681 is exactly one event and recovers at line 16682. The three rows withheld before playback (lines 24671, 28944 and 33589) are counted separately as **withheld pre-playback** and are not folded into a loss event, so the final rejected/held counter is 307 while the loss-event sample count is 304. Since events are rebuilt from the final playable rows after the parser withholds rows, a withheld row inside a rejection run cannot close or split that run; only rejected telemetry samples contribute event samples. This is a data-quality grouping, not a claim that every rejection was a physical sensor outage.

Playback timing is unchanged: the clock continues through the event, the crane holds its last accepted state, and the normal **STALE** state appears after more than 5 s without a newly accepted sample. The next accepted sample clears STALE and closes the event. The divergence badge also shows **STALE** while that state is active (even though the last accepted row remains held), and **COMPLETE** when playback finishes; it returns to the normal comparison after a fresh accepted row. `getLossEvents()` exposes the summary and boundaries; `TelemetryAPI.getValidationState()` also includes the summary, while `getCounts()` keeps all per-row counters. The `#dqLoss` panel obtains the summary from `TelemetryAPI.getValidationState().loss` rather than reading the store directly.

### Named checks and thresholds

| Check | Rule | Severity |
|---|---|---|
| `checkFiniteValues` | Required `load_t`, `radius_m`, `slew_deg`, `hook_height_m`, `wind_kmh` must be finite; blank/NaN/Infinity is never coerced to 0 | REJECT |
| `checkLoadRange` | `−0.02 t ≤ load_t ≤ 5 t`. The lower bound is the documented ±0.02 t load-cell noise around an unloaded hook; the upper bound is the MCT 88 rated maximum | REJECT |
| `checkWindRange` | `wind_kmh ≥ 0`; a negative anemometer reading is impossible. 40 km/h is the kit's alert threshold, so there is no upper validity cap | REJECT |
| `checkRadiusRange` | `4 m ≤ radius_m ≤ 29 m` (guide: trolley travel "about 4–29 m"); no clamping, no zero special case | REJECT |
| `checkHookHeightRange` | `2 m ≤ hook_height_m ≤ 46 m` (guide: "roughly 2–46 m"); no clamping | REJECT |
| `checkSlewRange` | `−180° ≤ slew_deg ≤ +180°`; crossing the ±180° wrap is normal. Overshoot ≤ 0.5° is treated as rounding; more than 0.5° beyond the limit is invalid | WARN (≤ 0.5°) / REJECT (> 0.5°) |
| `checkTimestamp` | Strict ISO-8601 with an explicit offset and a real calendar date; the browser timezone is never assumed. The module flags duplicate/out-of-order timestamps as WARN; the merged playback policy withholds them in source order | REJECT (missing/unparseable; merged duplicate/backwards) / WARN (module-level duplicate/out-of-order) |
| `checkPhysicalJump` | Review heuristic scaled by elapsed time: radius change > 5 m/s, hook change > 3 m/s, wrap-aware slew change > 10 °/s | WARN only |
| `checkMotionBitConsistency` | Motion bit (hoist/trolley/slew) set but measured change below tolerance, or measured movement present but motion bit not set; conflicting limit switches (lsHookUp+lsHookDown, lsTrolleyOut+lsTrolleyIn) | WARN (consistency) / REJECT (conflicting switches) |
| `checkReverseDirection` | Motion bit direction (via limit switches lsHookUp/Down, lsTrolleyOut/In) disagrees with measured direction (rate-based), above REVERSE_TOLERANCE thresholds | WARN only |
| `checkAuxiliaryFields` | `moment_pct` finite and non-negative (else divergence is UNAVAILABLE), `status_word` integer in `0..8191`, non-empty `imei`, empty or documented `event`, exactly 10 columns | WARN only |

Interpretation notes (project choices, not certified limits):

- The load tolerance is intentionally asymmetric: −0.02 t absorbs documented noise around an unloaded hook, while 5 t is a hard rated maximum. Zero load with otherwise valid fields is VALID — 39,595 accepted rows read exactly 0.00 t.
- Radius and hook ranges are the *approximate* operating envelope stated in the supplied column dictionary, treated here as inclusive strict bounds for this dataset.
- Jump thresholds were derived from the largest anomaly-free one-second changes observed in the supplied CSV (radius ≤ 4.0 m/s, hook ≤ 0.7 m/s, slew ≤ 4.2 °/s) plus headroom. The kit sources state no crane speed limit, so a jump is never called "physically impossible"; it is flagged for review while playback continues.
- The motion-bit consistency check uses only the documented motor-running bits (`hoist`, `trolley`, `slew`). It compares the bit state against the measured position change since the previous sample (an observed convention in this CSV, not a KIT-documented timing rule). Requiring the same contradiction on two consecutive intervals avoids flagging legitimate starts, stops, and rounding. The no-motion tolerances — **0.05 m** for hook height/radius and **0.1°** for slew — are project data-quality choices based on display resolution and observed jitter/rounding, not manufacturer sensor specifications.
- No reverse-direction validation is performed for slew. The KIT documents no forward/reverse bits for hoist, trolley, or slew beyond the limit switches (lsHookUp/Down, lsTrolleyOut/In), so those checks compare limit-switch direction vs measured rate where available.

### Full-dataset result (read-only scan)

The source CSV is never modified; the validation test recomputes its canonical LF Git blob SHA-1 and asserts that it matches the recorded hash.

Module-level scan (`telemetry-validation.js` on its own):

| Metric | Count |
|---|---|
| Rows validated | 46,800 |
| Accepted | 46,496 |
| Rejected / held last good | 304 |
| **Warnings** | **1,327** |
| Zero-load rows accepted | 39,595 |

Merged parser/playback (`script.js` + validation module, as used by the app):

| Metric | Count |
|---|---|
| Rows validated | 46,800 |
| Playable rows in source order | 46,797 |
| Applied / accepted | 46,493 |
| Final rejected / held | 307 |
| **Warnings** | **1,325** |

**Why the module and merged counts differ.** The module scan runs `createStore().handle()` over all 46,800 rows before the parser's final playback policy, so it reports 46,496 accepted / 304 rejected / 1,327 warnings. `parseTelemetryCSV()` then withholds three rows that the module accepted or warned about: line 24671 (module OK; overload-bit cross-channel contradiction), line 28944 (module WARN; duplicate + backwards timestamp), and line 33589 (module WARN; duplicate timestamp). `markStoreRejected()` adjusts the module store exactly once for those three rows: accepted 46,496 − 3 = **46,493**; warnings 1,327 − 2 = **1,325** (line 24671 was OK, so it removes no warning); rejected/held 304 + 3 = **307**. The 304 module-level rejects remain in the playable rows so the timestamp clock keeps advancing and the session holds last-good; the three withheld rows are removed from the 46,797 playable rows.

Rejected rows by category:

| Category | Rows | Lines (header = line 1) | What the rules see |
|---|---|---|---|
| Single-sample physically impossible spikes | 3 | 5653, 7962, 14285 | See the next subsection |
| Missing telemetry | 1 | 42933 | Empty `load_t`; rejected by `checkFiniteValues`, not defaulted to 0 |
| Suspected sensor dropout | 300 | 16382–16681 (10:33:00–10:37:59) | Every field frozen at zero; each row individually rejected by `checkRadiusRange` + `checkHookHeightRange`; line 16682 resumes normal values |
| Duplicate + backwards source timestamp | 1 | 28944 | Duplicate instant of line 28914 and earlier than the preceding source timestamp; withheld in source order |
| Duplicate source timestamp | 1 | 33589 | Duplicate of line 33588; withheld in source order |
| Documented-bit cross-channel contradiction | 1 | 24671 | Overload bit set with implausibly low moment/load; withheld by the Cycle 3 cross-channel check |

Counters (`store.getCounts()`) count unique rows by `rowId` (CSV line number); replaying a row for display revalidates it but does not increment counters or duplicate the anomaly list. `byRule` counts affected *rows* per rule, while `reasonHits` counts individual findings; a row that trips two rules counts once in each. Module-only rule hits: `checkMotionBitConsistency` 1,210 · `checkRadiusRange` 301 · `checkHookHeightRange` 301 · `checkSlewRange` 139 · `checkPhysicalJump` 6 rows / 8 reasons · `checkTimestamp` 2 rows / 3 reasons · `checkLoadRange` 1 · `checkFiniteValues` 1 · `checkWindRange` 0 · `checkAuxiliaryFields` 0 · `checkReverseDirection` 0. The merged store additionally counts the three Cycle 3 withholdings exactly once, so its totals are 46,493 accepted / 307 rejected / 1,325 warnings. The 300 dropout rows trip radius and hook together, which is why `byRule` sums to more than the row count.

Warnings in the merged run: 139 slew boundary overshoots (readings of ±180.1°/180.2°) and 3 jump-only review warnings. The module's two timestamp warnings are the duplicate/backwards rows at lines 28944 and 33589, which the merged playback policy withholds as final rejections. The new `checkMotionBitConsistency` check generates 1,183 warnings (mostly "measured movement present but motion bit not set" because the synthetic dataset has status_word=0 for most rows while actual movement occurs). `checkReverseDirection` generates 0 warnings in this dataset (no limit switch bits set to compare against). These rows and their immediate neighbours are the only departures from the 1 Hz cadence in the file (four non-1000 ms gaps in total); every other consecutive timestamp gap is exactly 1000 ms.

### First three physically impossible rows

Line numbers include the header, so data starts at line 2. These are the first three hard rejections in device/line order; each is a single-sample spike bracketed by normal rows.

**1. Line 5653 — `2026-09-15T07:34:11+05:30` — `radius_m = 33.40 m`**

Rule: `checkRadiusRange`. Evidence: trolley travel is about 4–29 m and the installed jib is 30 m, so 33.40 m is beyond the jib; the previous and next rows read 9.60 m. Raw line:

```csv
2026-09-15T07:34:11+05:30,000000000000001,3.41,33.40,-139.8,33.00,9.2,140.6,393,
```

Handling: **REJECT — held last good** (line 5652 state, 3.46 t at 9.60 m). The clock advanced to line 5654 and the twin resumed at 9.60 m instead of drawing the teleport.

**2. Line 7962 — `2026-09-15T08:12:40+05:30` — `load_t = −0.70 t`**

Rule: `checkLoadRange`. Evidence: negative mass beyond the documented ±0.02 t noise floor; the previous and next rows read 0.00 t. Raw line:

```csv
2026-09-15T08:12:40+05:30,000000000000001,-0.70,28.50,-180.0,21.30,10.6,0.0,256,
```

Handling: **REJECT — held last good** (previous load 0.00 t). Playback continued to line 7963 with no animation to −0.70 t.

**3. Line 14285 — `2026-09-15T09:58:03+05:30` — `hook_height_m = −1.80 m`**

Rule: `checkHookHeightRange`. Evidence: hook height is measured above ground and the guide gives roughly 2–46 m; −1.80 m is below ground; the previous and next rows read 27.70 m. Raw line:

```csv
2026-09-15T09:58:03+05:30,000000000000001,0.00,7.30,-80.7,-1.80,11.0,0.0,0,
```

Handling: **REJECT — held last good** (previous hook height 27.70 m). Playback continued to line 14286 at 27.70 m.

The remaining 304 final rejections are not additional single-sample spikes: 1 missing `load_t` (line 42933), the 300 frozen dropout rows (lines 16382–16681), and the 3 source-order/cross-channel withholdings at lines 28944, 33589 and 24671. The dropout is rejected per row, so the twin holds the last good pre-dropout state through the block and resumes at line 16682; for the user-facing summary those 300 rows are one loss event, while the rejected/held counters remain 300.

### Interaction with playback, MANUAL and the divergence badge

- The transport stays timestamp-driven (`tsMs`); a rejected sample does not pause, stop or rewind the clock, change the speed multiplier, or alter play/pause/resume behaviour.
- LIVE/MANUAL is unchanged: in LIVE, accepted telemetry updates the sliders; dragging the hoist/trolley/slew/load slider drops to MANUAL exactly as before. Validation only runs while telemetry is being consumed, so it cannot overwrite manual input.
- The divergence badge (`divergence.js`, separate Cycle 3 module) and its 5 percentage-point tolerance are unchanged. Auxiliary `moment_pct` / `status_word` problems remain WARN so the sample still plays; the documented-bit cross-channel contradiction is withheld. The badge uses the last accepted/held sample during normal playback, shows **STALE** while the established stale policy is active, shows **COMPLETE** at playback end (complete takes precedence), and reports unavailable device data as UNAVAILABLE.
- `TelemetryAPI.getValidationState()` exposes dataset counters, by-rule totals, the loss event summary, and the grouped loss events for diagnostics. The `#dqLoss` panel consumes that API summary; its renderer does not perform a separate direct store-only loss read.

### Tests and verification (actual results)

Run from the repository root; no dependencies and no build step:

```bash
node tests/verify-validation.js             # 65 checks — ALL PASSED
node tests/verify-playback-integration.js   # 18 checks — ALL PASSED
node tests/verify-divergence.js             # teammate baseline — ALL PASSED
node tests/verify-round1.js                 # Cycle 1 baseline — ALL PASSED
node tests/verify-wind-derating.js          # Round 3 baseline — ALL PASSED
node tests/verify-cycle3-audit.js           # 11 checks — ALL PASSED
node tests/verify-cycle3-audit2.js          # 14 checks — ALL PASSED
node tests/verify-cycle3-audit3.js          # 19 checks — ALL PASSED
node --check telemetry-validation.js        # syntax OK (same for script.js and the other modules)
```

The validation suite includes a read-only full-file scan (module-level accepted/rejected counts above, the three first rows, the 300-row dropout as one loss event, WARN playback, counter idempotence and the unchanged CSV hash). The integration suite executes the real `parseTelemetryCSV()` from `script.js` and confirms that the merged parser yields 46,797 playable rows, 46,493 reach the state applier and 304 module rejects never do; that the three parser-withheld rows are counted separately; that the grouped loss summary is 5 events / 304 samples / longest 300; that 2,428 of the 46,493 accepted rows are DIVERGENT at 5 pp (5.22%); that the timestamp clock, slider-to-MANUAL switch, LIVE transport and the divergence 5 pp wiring are preserved; and that replaying rows does not mutate dataset counters or loss events.

### Real vs. simulated

| Element | Real / sourced | Simulated or chosen in this prototype |
|---|---|---|
| Crane and load chart | Potain MCT 88 C25 published data: 30 m jib, 2.70 t tip, 5 t maximum, 81 t·m moment (`docs/SOURCES.md`) | `capacityAt()` is an idealised load-moment teaching model, not the complete manufacturer chart |
| Telemetry field definitions | Field names, units and `status_word` bits follow the DRM 3400 monitor description in `README-for-students.md` | All row values are synthetic; the IMEI is a placeholder; there is no real site or device |
| Timestamps | ISO-8601 with an explicit `+05:30` IST offset, as required for the stream | The 2026-09-15 working day is generated, not recorded |
| Operating limits | 5 t maximum load, trolley travel about 4–29 m, hook height roughly 2–46 m, ±0.02 t load noise, −180°…+180° slew from the supplied column dictionary | Strict inclusive bounds and the 0.5° slew rounding tolerance are project interpretations for this dataset |
| Jump thresholds | No manufacturer speed limit is supplied | 5 m/s, 3 m/s and 10 °/s are review heuristics derived from anomaly-free observed changes, not certified limits |
| Wind | 40 km/h is the kit's alert threshold | The 0.8× capacity derate at ≥ 20 km/h is a simulated product rule; the cited EN 14439 Table 7 is unverified |
| Divergence badge | Device `moment_pct` is the value transmitted by the device; model utilisation is computed independently from the capacity model | The 5 percentage-point badge tolerance is a team UI choice, not a manufacturer limit; neither value is a certified real-crane measurement |
| Playback | Timestamps drive the clock, as specified | Offline CSV replay, not a live sensor connection |

### Boundaries

- This is a data-quality and decision-support layer, not a certified safety system.
- Validation counts and diagnoses per row; it cross-checks the documented motor-running bits against position movement, and only as WARN-only review. It does not validate direction (no documented direction bits beyond limit switches), does not validate speed against a certified limit, does not detect slow drift, and does not estimate load-cell calibration error.
- The 300-row frozen block is one loss event for the user-facing summary and 300 individual rejected/held rows in the counters (shown as REJECT + held), with per-row diagnostics retained. The normal playback STALE state appears after 5 s without a new accepted sample; there is no separate per-dropout banner.
- A feed without a timestamp offset would be rejected entirely; that strictness is deliberate and documented in the module header.
- Duplicate/backwards timestamps are never sorted away or merged; the affected rows are withheld and counted.

## Project Status

Current milestone: **Cycle 3 — telemetry-driven twin prototype.**

Status: Cycle 3 playback, LIVE/MANUAL override, divergence badge and telemetry validation are integrated on this branch. All five required test suites and all three Cycle 3 audit suites pass. The Cycle 2 capacity validation remains the engineering baseline; the Cycle 3 dataset is synthetic and the validation layer is a data-quality guard, not a certified safety system.

Possible future work (not implemented):

- live physical sensor feed (Cycle 3 uses offline CSV replay)
- BIM/site model integration
- richer crane configurations
- more detailed engineering models around the validation heuristics