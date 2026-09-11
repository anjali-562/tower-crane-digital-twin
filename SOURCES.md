# SOURCES — Cycle 2 (Potain MCT 88, starter-kit build)

Never cite an AI response as the source. Every number below was read from
the manufacturer documentation or the mentor's starter kit (which itself
quotes real brochure figures). Conversions are shown explicitly.

## 1. Potain MCT 88 manufacturer source

- Crane: Potain MCT 88 (EN 14439 C25), top-slewing flat-top tower crane.
- Official interactive catalogue (starter-kit §4):
  https://www.manitowoc.com/potain-ecatalog-en14439-c25d25.html
  — serves humans fine but blocks bots/scripts, so per-radius values below
  were read from the datasheet PDF mirror instead (same Manitowoc sheet).
- Max capacity used: 5 t (sheet's imperial row max 5.5 USt = 4.99 t).

## 2. Exact load-chart document

- Document: Potain MCT 88 Data Sheet, FEM 1.001-A3 (Manitowoc,
  Code 09-003-.5M-0610), page/section "Load charts".
- Copy consulted: cranenetwork.com mirror of the Manitowoc sheet
  (…potain_mct_88_tower_crane_network.pdf), p.3 "Load charts".
- Row used: 98 ft jib (≈29.87 m ≈ 30 m nominal), UPPER line
  (2-fall / max 5.5 USt configuration matching the 5 t MCT88 model).
  Lower line is the reduced (single-fall/hook-limited) curve and was NOT used.
- Raw readings (imperial, upper 98 ft row):
  66 ft → 4.3 USt · 82 ft → 3.3 USt · 98 ft → 2.8 USt.
- (Neighbouring columns for context: 53→5.5, 56→5.3, 72→3.9, 89→3.0,
  95→2.8 USt; 90 ft column is blank "–" in the sheet.)

## 3. URL / page / section

- E-catalog: https://www.manitowoc.com/potain-ecatalog-en14439-c25d25.html
- Sheet mirror: https://cranenetwork.com/uploads/specs/5v6gyg3ds4sb0wjmpotain_mct_88_tower_crane_network.pdf
- Page/section: "Load charts", 98 ft jib row, upper line.
- Starter kit: STARTER-KIT.md §§1–2, capacity.starter.js (MCT88 tip table).

## 4. Which values were extracted

- Tip-load table (metric, STARTER-KIT §2 real brochure figures, jib m → tip t):
  20→3.95 · 25→3.00 · 30→2.70 · 35→2.27 · 40→1.95 · 45→1.70 · 50→1.45 · 53.1→1.15.
- Three validation chartT values (converted 1 ft = 0.3048 m, 1 USt = 0.907185 t):
  66 ft = 20.1 m → 4.3 USt = 3.90 t;
  82 ft = 25.0 m → 3.3 USt = 2.99 t;
  98 ft = 29.9 m → 2.8 USt = 2.54 t.
- Stored in script.js as CHART30 and validated with validate(MCT88, 30, CHART30).

## 5. Date accessed

- 2026-09-11 (datasheet mirror + e-catalog verification attempt).

## 6. What was NOT taken from the source / needs verification

- The capacityAt() two-piece curve is the starter-kit's idealisation, NOT the
  manufacturer's equation; the sheet's own 98 ft tip (2.8 USt = 2.54 t) sits
  ~6% below the metric tip-table value (2.70 t) — reported as a discrepancy,
  not silently reconciled (different standard/rounding: ASME vs FEM).
- Buildings, pickup/delivery positions, wind sway, speeds: simulated scene.
- Thresholds ≥1.0 danger / ≥0.9 warning: starter-kit wiring choice, not a
  manufacturer limit.
- No structural, dynamic, reeving-change or certified lift-planning logic.
- WHAT WE DON'T KNOW: the metric-edition per-radius row for the 30 m jib
  (would remove the imperial→metric conversion); if the mentor supplies it,
  CHART30 gets replaced and re-validated.
