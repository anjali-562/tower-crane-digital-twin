# Cycle 3 — Tower Crane: drive the twin from a telemetry stream

**Team:** Tower Crane (Anjali, Puja, Namya)
**Dataset:** `tower-telemetry-2026-09-15.csv` — 46,800 rows, one synthetic working day
**Crane:** Potain MCT 88 (C25) at the 30 m validation jib you already use in `capacity.js`
(tip load 2.70 t → M = 81 t·m, corner radius 16.2 m, max hook load 5 t)

This is **synthetic data** generated for the exercise. It is not a real site, not a real device,
and the IMEI is a placeholder — but the field shape, the units and the status-word bits are the
real ones from the DRM 3400 tower-crane monitor, so whatever you build here transfers.

---

## 1. The assignment

Up to now your sim has been driven by sliders: you set a value, the model shows it. That is a
*visualisation*. A twin follows the real machine. So:

1. **The sim must follow this stream.** Play the CSV back in time order (real time, or a speed
   multiplier — your choice, but the playback clock must come from the `ts` column, not from
   `requestAnimationFrame` counting frames). Hook height, radius, slew and load all come from the
   file.
2. **Sliders become an override, not the source of truth.** Add a clear mode switch:
   `LIVE (telemetry)` vs `MANUAL (override)`. In LIVE mode the sliders must visibly reflect the
   incoming values; touching one drops you into MANUAL and that has to be obvious on screen.
3. **Add a live-vs-computed divergence badge.** The stream carries `moment_pct` and a
   `status_word` with an overload bit. You also compute utilisation yourself from `load_t`,
   `radius_m` and `capacityAt()`. Show both, and show the gap. When the device's number and your
   number disagree by more than a tolerance you choose (state it), the badge goes amber/red and
   says which side is claiming what. A twin that silently trusts the device is not a twin.
4. **Report the first three physically impossible rows you find, and how you handled them.**
   The stream is real-world-shaped, which means it is not clean. Somewhere in this file are rows
   that cannot describe a real crane. Find them, say how your code detected them (the rule, not
   the row number), and say what your sim does when one arrives — reject? clamp? hold last good?
   freeze and show STALE? There is no single right answer, but "the crane teleported and we drew
   it" is a wrong one.

Deliverable: your repo updated + a short section in the README covering point 4, plus a 2-minute
demo (screen recording is fine) showing LIVE playback, the override switch and the badge reacting.

---

## 2. Column dictionary

| Column | Type | Unit | Notes |
|---|---|---|---|
| `ts` | string | ISO-8601 with offset | Device timestamp, **IST (`+05:30`)**. Always parse the offset; never assume UTC or local browser time. |
| `imei` | string | — | Device identity. Synthetic placeholder (`000000000000001`). Keep it a **string** — leading zeros matter. |
| `load_t` | float | tonnes (t) | Hook load from the load cell. Includes ±0.02 t of sensor noise — do not treat every wobble as a lift. |
| `radius_m` | float | metres | Working radius = trolley distance from the mast centre. Trolley travel on this crane is about 4–29 m. |
| `slew_deg` | float | degrees | Slew angle, −180…+180, 0 = reference bearing. Wraps at ±180. |
| `hook_height_m` | float | metres | Hook height above ground, roughly 2–46 m. |
| `wind_kmh` | float | **km/h** | Anemometer at the jib head. Alert threshold in this kit: **40 km/h**. (Careful: many crane datasheets quote m/s. This column is km/h.) |
| `moment_pct` | float | % | Load moment as transmitted by the device: `load_t × radius_m ÷ 81 t·m × 100`. It is a *derived* value sent by the device — see assignment point 3. |
| `status_word` | int | bitmask | Decimal integer. Decode with bitwise AND — see below. |
| `event` | string | — | Short label on the sample where a condition **first** becomes true, otherwise empty. Values used: `OVERLOAD_WARN`, `WIND_ALERT`, `LS_TRIP`. |

**Cadence:** one row per second, 06:00:00 → 18:59:59 IST. Rows are in device order.

---

## 3. `status_word` bits

Decimal integer; test a bit with `(sw & MASK) !== 0`. These are the DRM 3400 field names.

| Bit | Mask (hex) | Mask (dec) | Field | Meaning |
|---|---|---|---|---|
| 0 | `0x0001` | 1 | `hoist` | Hoist motor running |
| 1 | `0x0002` | 2 | `trolley` | Trolley motor running |
| 2 | `0x0004` | 4 | `slew` | Slew motor running |
| 3 | `0x0008` | 8 | `utilisation` | Device-side high-utilisation flag (set from ~90 %) |
| 6 | `0x0040` | 64 | `wind` | Wind alert active (kit extension on this feed) |
| 7 | `0x0080` | 128 | `overload` | Overload detected |
| 8 | `0x0100` | 256 | `LS4` | Limit switch — trolley OUT |
| 9 | `0x0200` | 512 | `LS3` | Limit switch — trolley IN |
| 10 | `0x0400` | 1024 | `LS2` | Limit switch — hook DOWN |
| 11 | `0x0800` | 2048 | `LS1` | Limit switch — hook UP |
| 12 | `0x1000` | 4096 | `test_mode` | Operator is **currently in test mode** (key turned on) |

Two things worth knowing, because they trip people up on the real product:

- `test_mode` means "test mode is active right now". It does **not** mean "the daily test passed".
  Early in the day you will see a short burst of test-mode rows with the four limit switches
  tapped in turn — that is the daily LS test, not a fault.
- The motor bits (`hoist` / `trolley` / `slew`) are what the device says the machine is doing.
  The position columns are what it says the machine *is*. Those two can disagree. When they do,
  that is information, not noise.

---

## 4. Suggested order of work

1. Get playback working with a fixed speed multiplier and the existing 3D scene following it.
   Do this before anything else — everything below needs it.
2. Add the LIVE/MANUAL switch.
3. Recompute utilisation from `load_t` + `radius_m` with your existing `capacityAt(MCT88, 30, r)`
   and put the two numbers side by side. Then add the divergence badge.
4. Now add validation, because by this point a bad row will have visibly broken something on
   screen and you will know what you are defending against. Write the rules as a small list of
   named checks (one function per check) so the write-up is easy.
5. A simple data-quality counter panel (rows accepted / rejected / held) is cheap and makes the
   demo much more convincing.

## 5. Ground rules

- Keep it `file://`-openable — no build step, same as Cycles 1 and 2.
- No dependency on any DGOC production code. Reimplement, don't import.
- Don't hand-patch the CSV. Fixing bad data in the file instead of in the code is the one way to
  fail this exercise.
- Don't invent numbers for the crane that you cannot source. The load chart anchors you already
  cited in `SOURCES.md` are the ones to use.

Questions → the **Digital Twin** WhatsApp group.
