# Tower Crane Digital Twin

A simulation-based digital twin prototype for a Potain MCT 88-class tower crane, developed to study crane operation, load-capacity behavior, safety states, and spatial constraints in a construction-site environment.

![Status](https://img.shields.io/badge/status-Cycle%202%20prototype-lightgrey)
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
- Engineering-oriented telemetry panel

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
├── script.js
├── style.css
├── capacity.js
├── ui-mirror.js
├── README.md
├── docs/
│   ├── CYCLE2_SUMMARY.md
│   ├── SOURCES.md
│   ├── validation-calculation.txt
│   └── reference/            # student/Cycle 3 material, not part of the Cycle 2 deliverable
└── tests/
    └── verify-round1.js
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

- **Syntax:** `node --check script.js`, `node --check capacity.js` (plain scripts, file:// compatible, no modules).
- **Engineering validation:** `validate(MCT88, 30, CHART30)` runs in the browser console on boot against the three published chart points above; the Validation tab renders the same comparison.
- **Round 1 scenario verification:** `node tests/verify-round1.js` checks that the four required jib/radius/load combinations reach the calculation layer without being rounded or clamped, and that a radius beyond the installed jib returns out-of-range. It also verifies the slider bounds in `index.html`.
- **Round 3 wind-derate verification:** `node tests/verify-wind-derating.js` checks the 0.8× simulated product rule (no-wind baseline, 19/20/25 km/h, corner region, out-of-range null).
- **Cycle 2 validation:** worst error 8.4% against the ±10% acceptance threshold — PASS (see table above).

## Limitations

- Simulation only; not a certified crane safety system.
- Load capacity uses an idealized load-moment model, not the full manufacturer chart logic.
- Actual crane operation may involve additional chart, configuration, reeving, and derating constraints.
- No live physical crane sensor feed is currently connected.
- No structural dynamics model.
- No wind-load physics model (Round 3 adds a SIMULATED 0.8× product derate at ≥ 20 km/h; not a certified wind-load calculation. The categorical LOW/MODERATE/HIGH wind remains visual only).
- No certified lift planning.
- No production operational deployment.

## Source / References

Manufacturer and chart sources are documented in [`docs/SOURCES.md`](docs/SOURCES.md). The primary source is the official Manitowoc Potain e-catalogue (EN 14439 C25 range); per-radius validation values were read from the Potain MCT 88 data sheet (FEM 1.001-A3, "Load charts" page, 98 ft row). See that file for document codes, conversion notes, and known discrepancies.

## Project Status

Current milestone: **Cycle 2 — engineering validation prototype.**

Status: complete for the current Cycle 2 scope. The implementation demonstrates crane simulation, capacity calculation, risk assessment, spatial constraints, and published-data validation.

Possible future work (not implemented):

- live telemetry integration
- BIM/site model integration
- richer crane configurations
- more detailed engineering models

(End of file - will replace README.md)
