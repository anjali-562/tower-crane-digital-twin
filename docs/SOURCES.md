# Sources — Cycle 2 (Potain MCT 88)

Never cite an AI response as a source. Every number below was read from
the manufacturer documentation or the project starter kit (which itself
quotes real brochure figures). Conversions are shown explicitly.

## 1. Manufacturer source

- Crane: Potain MCT 88 (EN 14439 C25), top-slewing flat-top tower crane.
- Official interactive catalogue:
  <https://www.manitowoc.com/potain-ecatalog-en14439-c25d25.html>
  — serves human browsers but blocks automated fetching, so the
  per-radius values below were read from the datasheet PDF mirror
  instead (same Manitowoc sheet).
- Maximum capacity used: 5 t (the sheet's imperial row maximum of
  5.5 USt converts to 4.99 t).

## 2. Load-chart document

- Document: Potain MCT 88 Data Sheet, FEM 1.001-A3 (Manitowoc,
  Code 09-003-.5M-0610), section "Load charts".
- Copy consulted: cranenetwork.com mirror of the Manitowoc sheet
  (<https://cranenetwork.com/uploads/specs/5v6gyg3ds4sb0wjmpotain_mct_88_tower_crane_network.pdf>),
  p. 3, "Load charts".
- Row used: 98 ft jib (≈ 29.87 m ≈ 30 m nominal), UPPER line
  (2-fall / maximum 5.5 USt configuration, matching the 5 t model).
  The lower line is the reduced (single-fall / hook-limited) curve
  and was NOT used.
- Raw readings (imperial, upper 98 ft row):
  66 ft → 4.3 USt · 82 ft → 3.3 USt · 98 ft → 2.8 USt.
- Neighbouring columns for context: 53 → 5.5, 56 → 5.3, 72 → 3.9,
  89 → 3.0, 95 → 2.8 USt; the 90 ft column is blank ("–") in the sheet.

## 3. Values extracted

- Tip-load table (metric, jib m → tip t):
  20 → 3.95 · 25 → 3.00 · 30 → 2.70 · 35 → 2.27 ·
  40 → 1.95 · 45 → 1.70 · 50 → 1.45 · 53.1 → 1.15.
- Three validation values (1 ft = 0.3048 m, 1 USt = 0.907185 t):
  66 ft = 20.1 m → 4.3 USt = 3.90 t;
  82 ft = 25.0 m → 3.3 USt = 2.99 t;
  98 ft = 29.9 m → 2.8 USt = 2.54 t.
- Stored in `script.js` as `CHART30` and checked with
  `validate(MCT88, 30, CHART30)` from `capacity.js`.

## 4. Date accessed

2026-09-11 (datasheet mirror and e-catalog verification attempt).

## 5. Project notes (not manufacturer data)

The following are project or starter-kit choices, not brochure figures:

- The `capacityAt()` two-piece curve is an idealisation for teaching,
  NOT the manufacturer's equation. The sheet's own 98 ft tip
  (2.8 USt = 2.54 t) sits ~6% below the metric tip-table value
  (2.70 t) — reported as a discrepancy, not silently reconciled
  (different standard / rounding: ASME vs FEM).
- Buildings, pickup / delivery positions, wind sway, and speeds are
  simulated scene content.
- The ≥ 1.0 DANGER / ≥ 0.9 WARNING thresholds are a project wiring
  choice, not a manufacturer limit.
- No structural, dynamic, reeving-change, or certified lift-planning
  logic is included.
- Open item: the metric-edition per-radius row for the 30 m jib
  (which would remove the imperial → metric conversion). If it is
  supplied, `CHART30` gets replaced and re-validated.

## 6. Round 3 wind-derate note (SIMULATED PRODUCT RULE, citation unverified)

- Round 3 ticket specifies: wind speed at or above 20 km/h → rated
  capacity × 0.8, described as "per EN 14439 Table 7".
- The available project sources (manufacturer e-catalogue reference,
  MCT 88 Data Sheet FEM 1.001-A3 load-charts page as mirrored, and the
  starter-kit notes above) do NOT contain the cited Table 7 text, a 0.8
  wind factor, or a 20 km/h wind-derate threshold. The citation has
  therefore NOT been independently verified from project evidence.
- Implemented strictly as a product-requested simulation rule:
  `capacityAt(model, jibM, radiusM, windKmh)` returns the existing base
  capacity when `windKmh` is absent or < 20 km/h, and `base × 0.8` when
  `windKmh >= 20 km/h` (out-of-range `null` stays `null`).
- This is a simplified simulation rule, NOT a certified wind-load
  calculation. No new published wind-rated chart data was supplied, so
  the existing Cycle 2 validation (30 m jib, ±10%) remains the
  baseline/no-wind validation; the derated model is not claimed to be
  validated against the manufacturer chart.
