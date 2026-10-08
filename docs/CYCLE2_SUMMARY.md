# Cycle 2 Summary — Potain MCT 88 Engineering Validation Prototype

Milestone report for the Cycle 2 build: a simulation-based tower-crane
prototype with a validated load-moment capacity model. See `SOURCES.md`
for references and `validation-calculation.txt` for the hand derivation.

## 1. Crane selected

Potain MCT 88 (C25), top-slewing flat-top tower crane, by Potain /
The Manitowoc Company, Inc. (EN 14439 C25).

## 2. Configuration

- Validation jib: **30 m** (installed configuration chosen for validation).
- Tip-load table covers **20–53.1 m**; the simulator's jib slider
  (20–53.1 m, 0.1 m steps) interpolates tip load via `tipLoadAt()`.
- Presets: Standard 30 m (validated), Short 20 m, Tall-mast (visual only).
- Note: the 52 m figure quoted for the MCT 88 family is the model's
  maximum jib — 30 m is the installed configuration used here.

## 3. Manufacturer source

- E-catalog: <https://www.manitowoc.com/potain-ecatalog-en14439-c25d25.html>
  (bot-blocked for scripts; verified in a normal browser session).
- MCT 88 Data Sheet FEM 1.001-A3, "Load charts" page, 98 ft (≈ 30 m) row,
  upper 5.5-USt line, consulted via datasheet mirror. See `SOURCES.md`.
- Accessed 2026-09-11.

## 4. Load-chart values used

Tip table (jib m → tip t):

```text
20 → 3.95 · 25 → 3.00 · 30 → 2.70 · 35 → 2.27 ·
40 → 1.95 · 45 → 1.70 · 50 → 1.45 · 53.1 → 1.15
```

Per-radius validation points, 98 ft row converted (ft → m, USt → t):

```text
20.1 m → 3.90 t · 25.0 m → 2.99 t · 29.9 m → 2.54 t
```

## 5. Load-moment model (starter-kit §1, exact)

```text
M       = tipLoadAt(model, jibM) × jibM
cornerR = M / maxCapacityT
r <= 0          → maxCapacityT
r > jibM        → null (out of range)
r <= cornerR    → maxCapacityT
otherwise       → M / r        (never exceeds maxCapacity)
```

30 m jib: M = 2.70 × 30 = **81 t·m**; corner = 81 / 5 = **16.2 m**.

## 6. Validation points

(20.1 m, 3.90 t), (25.0 m, 2.99 t), (29.9 m, 2.54 t) — inner/mid,
middle, and near-tip readings from the 98 ft row.

## 7. Validation errors

| Radius | Model  | Published | Error | Status |
|--------|--------|-----------|-------|--------|
| 20.1 m | 4.03 t | 3.90 t    | 3.3%  | PASS   |
| 25.0 m | 3.24 t | 2.99 t    | 8.4%  | PASS   |
| 29.9 m | 2.71 t | 2.54 t    | 6.7%  | PASS   |

Worst error **8.4%** against the **±10%** acceptance threshold → **PASS**.
Reproduce: `validate(MCT88, 30, CHART30)` in the browser console.

## 8. Implementation

- **Capacity badge:** `cap = capacityAt(MCT88, jibLen, radius)`,
  `util = load / cap`. ≥ 1.0 (or out-of-range) → DANGER,
  ≥ 0.9 → WARNING, else WITHIN CAPACITY. Updates live with
  trolley / load / jib / automatic lift.
- **Working radius input:** the trolley slider uses absolute bounds
  (2–53.1 m). A radius beyond the installed jib is preserved and
  reported as out-of-range; it is never silently clamped to the jib.
- **Exclusion zones:** `hookInZone(hookX, hookZ, rect)` from
  `capacity.js`, evaluated every frame on the `hookWorld()` ground
  point. Rects: base x[−9, 9] z[−9, 9] (hook height < 12 m),
  storage x[14, 24] z[−8, 2], plus the Crane-2 circle as a
  documented extra. Inside → EXCLUSION ZONE VIOLATION (highlighted);
  outside → PATH CLEAR. Obstacle avoidance only — never confused
  with load-moment safety.
- **Building clearance:** simplified geometric check against building
  volumes with an early-warning buffer; reported separately from
  capacity. Not a certified clearance analysis.

## 9. What is real, calculated, and simulated

- **Real:** MCT 88 identity, 5 t maximum capacity, published tip loads,
  per-radius chart points, validation radii, the `hookInZone()`
  geometry test, EN 14439 / FEM references.
- **Calculated:** M, corner radius, `capacityAt()` at the current
  radius, utilization, validation errors, zone-in / zone-out state.
- **Simulated:** 3D crane / mast / jib / trolley / hook / load
  animation, buildings and site layout (sited inside 30 m reach),
  pickup / delivery props, wind sway visual, demo lift sequencing,
  speeds, and the presentation of thresholds.

## 10. Verification status

- `node --check src/script.js` / `src/capacity.js` — clean.
- `node tests/verify-round1.js` — all checks pass: the four required
  jib / radius / load combinations reach the calculation layer
  unrounded and unclamped; radius beyond the installed jib returns
  out-of-range.
- Cycle 2 validation — PASS (worst 8.4%, threshold ±10%).

## 11. Still missing for a full digital twin

Continuous physical-to-virtual synchronization, real sensor or
operational data, validated dynamics, broader live site state, and a
feedback / decision loop. Current status: data-driven simulation
prototype.

## 12. Limitations and known discrepancies

1. Per-radius points are imperial → metric conversions (ft → m,
   USt → t); a metric-edition 30 m row would remove conversion noise.
2. The sheet's own 98 ft tip (2.54 t) vs the tip-table 30 m value
   (2.70 t): ~6% gap (ASME vs FEM edition / rounding) — flagged, not
   hidden.
3. `capacity.js` exposes its names as globals (not ES-module
   `export`) so the page keeps working when opened via `file://`;
   logic and signatures are unchanged.
4. The e-catalog page blocks automated fetching; verification was
   done in a human browser session (see `SOURCES.md`).
