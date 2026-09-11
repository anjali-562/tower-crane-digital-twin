# Tower Crane Simulation — Cycle 2 (Potain MCT 88, starter-kit build)

Real crane: **Potain MCT 88 (C25)** · validation jib **30 m** · max **5 t** ·
tip (30 m) **2.70 t** · M = **81 t·m** · corner **16.2 m**.
Open `index.html` directly in Chrome/Edge (Three.js r128 via CDN plus local
`capacity.js`; internet needed only for the Three.js CDN).

## Physics (STARTER-KIT §1, in capacity.js)

`cap = capacityAt(MCT88, jibLen, radius)`: r ≤ 0 → 5 t; r > jib → null;
r ≤ corner → 5 t; else M / r with M = tipLoadAt × jib. The curve must pass
through the tip: capacity(30) = 2.70 t. Sanity: cap(5) = 5.00, cap(16.2) =
5.00, cap(20) = 4.05, cap(25) = 3.24, cap(30) = 2.70.

## Validation (PASS, worst 8.4 %)

Real per-radius points (MCT 88 sheet, 98 ft row, converted — see SOURCES.md):
20.1 m → 3.90 t (err 3.3 %) · 25.0 m → 2.99 t (8.4 %) · 29.9 m → 2.54 t
(6.7 %). Console runs validate(MCT88, 30, CHART30). Hand derivation
(cap 20 m = 4.05 t) in validation-calculation.txt — write it on paper too.

## Live panel + badge

REAL CRANE / JIB / CURRENT LOAD / CURRENT RADIUS / CALCULATED CAPACITY /
UTILIZATION / STATUS (≥1.0 DANGER · ≥0.9 WARNING · else WITHIN CAPACITY).
“SIMULATED ENGINEERING CHECK — NOT A CERTIFIED LIFT PLAN.”

## Zones + buildings

hookInZone() on the hookWorld() ground point: base rect, storage rect →
EXCLUSION ZONE VIOLATION (highlighted) or PATH CLEAR. Buildings: simplified
Box3 test → conflict + floor or CLEAR; labelled NOT A CERTIFIED CLEARANCE
ANALYSIS. Auto-lift (10 stages) shows load/radius/cap/util/zone/building
throughout and holds on DANGER or zone entry.

## Files

- `index.html` / `style.css` / `script.js` — sim (tabs SIMULATION, REAL
  CRANE, LOAD CHART, VALIDATION, CONSTRAINTS, DIGITAL TWIN)
- `capacity.js` — MCT88, tipLoadAt, capacityAt, validate, hookInZone
  (from capacity.starter.js; globals instead of export for file://)
- `SOURCES.md` · `validation-calculation.txt` · `CYCLE2_SUMMARY.md`
