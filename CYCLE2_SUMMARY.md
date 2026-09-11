# CYCLE2_SUMMARY — Potain MCT 88 starter-kit build

## A. Real crane selected

Potain MCT 88 (C25), top-slewing flat-top tower crane — the crane the
starter kit specifies (same flat-top the DRM 3D scene models).

## B. Manufacturer

Potain / The Manitowoc Company, Inc. (EN 14439 C25).

## C. Configuration

30 m installed jib (validation config). Tip-load table covers 20–53.1 m;
the sim's jib slider (20–53 m) interpolates tip load via tipLoadAt();
presets: Standard 30 m (validated), Short 20 m, Tall-mast (visual only).
Note: 52 m (170.6 ft max radius) is the crane model's maximum jib —
30 m is the installed configuration chosen for validation.

## D. Real source

E-catalog https://www.manitowoc.com/potain-ecatalog-en14439-c25d25.html
(bot-blocked for scripts, verified in a normal browser session) plus
MCT 88 Data Sheet FEM 1.001-A3 "Load charts" page (98 ft ≈ 30 m row,
upper 5.5-USt line), consulted via datasheet mirror. See SOURCES.md.
Accessed 2026-09-11.

## E. Real load-chart values

Tip table (m→t): 20→3.95 · 25→3.00 · 30→2.70 · 35→2.27 · 40→1.95 ·
45→1.70 · 50→1.45 · 53.1→1.15. Per-radius (98 ft row, converted):
20.1 m→3.90 t · 25.0 m→2.99 t · 29.9 m→2.54 t.

## F. Load-moment formula (STARTER-KIT §1, exact)

M = tipLoadAt(model, jibM) × jibM; cornerR = M / maxCapacityT;
r ≤ 0 → maxCapacityT; r > jibM → null;
r ≤ cornerR → maxCapacityT; else M / r. Never exceeds maxCapacity.

## G. Corner radius

30 m jib: M = 2.70 × 30 = 81 t·m; corner = 81 / 5 = 16.2 m.

## H. Three validation points

(20.1 m, 3.90 t), (25.0 m, 2.99 t), (29.9 m, 2.54 t) —
inner/mid, middle, near-tip from the 98 ft row.

## I. Validation errors

20.1 m: model 4.03 t → 3.3 % · 25.0 m: 3.24 t → 8.4 % ·
29.9 m: 2.71 t → 6.7 %. WORST 8.4 % ≤ 10 % → PASS
(reproduce: validate(MCT88, 30, CHART30) in the console).

## J. Capacity badge logic

cap = capacityAt(MCT88, jibLen, radius); util = load / cap.
≥1.0 (or out-of-range) → DANGER · ≥0.9 → WARNING · else WITHIN CAPACITY.
Updates live with trolley/load/jib/auto-lift. Old invented
load/10×0.5+… heuristic deleted.

## K. Exclusion-zone logic

hookInZone(hookX, hookZ, rect) from capacity.js every frame on the
hookWorld() ground point. Rects: base x[−9,9] z[−9,9] (y<12) ·
storage x[14,24] z[−8,2] · plus Crane-2 circle as documented extra.
Inside → EXCLUSION ZONE VIOLATION (+ red highlight); outside → PATH CLEAR.
Obstacle avoidance only — never confused with moment safety.

## L. What is real

MCT 88 identity, 5 t max, published tip loads, per-radius chart points,
validation radii, hookInZone geometry test, EN 14439/FEM references.

## M. What is calculated

M, corner radius, capacityAt() at current radius, utilization,
validation errors, zone-in/zone-out state.

## N. What is simulated

3D crane/mast/jib/trolley/hook/load animation, buildings + site layout
(resited inside 30 m reach), pickup/delivery props, wind sway visual,
demo lift sequencing, speeds, thresholds' presentation.

## O. Still missing for a Digital Twin

Continuous physical-to-virtual sync, real sensor/ops data, validated
dynamics, broader live site state, feedback/decision loop. Current status:
DATA-DRIVEN SIMULATION / PROTOTYPE.

## P. Limitations / discrepancies

1. Per-radius points are imperial→metric conversions (ft→m, USt→t);
   a metric-edition 30 m row would remove conversion noise.
2. Sheet's own 98 ft tip (2.54 t) vs tip-table 30 m (2.70 t): ~6% gap
   (ASME vs FEM edition/rounding) — flagged, not hidden.
3. Previous cycle used MDT 219 J10/65 m; the site was resited for the
   30 m jib and sliders re-ranged (load 0–5 t, trolley ≤ jib−1).
4. capacity.js ships as globals (not ES export) so file:// keeps working;
   logic/names identical to capacity.starter.js.
5. E-catalog page fetches empty for bots; human-browser verification noted.
