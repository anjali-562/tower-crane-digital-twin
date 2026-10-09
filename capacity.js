// capacity.js — tower-crane load-moment capacity. See STARTER-KIT.md §1, §5.
// Real brochure anchors: Potain MCT 88 (EN 14439 C25).
// NOTE (file:// compat): the starter scaffold uses ES-module `export`. This
// project opens index.html directly via file:// where modules are blocked, so
// this copy exposes the IDENTICAL names as globals (var + window) instead.
// Logic, names and signatures are unchanged from capacity.starter.js;
// the single TODO (capacityAt) is implemented per STARTER-KIT §1 exactly.
var MCT88 = {
  label: 'Potain MCT 88 (C25)',
  maxCapacityT: 5,
  tipLoadByJib: [ // jib length (m) -> published tip load (t)
    { jibM: 20, tipT: 3.95 }, { jibM: 25, tipT: 3.0 }, { jibM: 30, tipT: 2.7 },
    { jibM: 35, tipT: 2.27 }, { jibM: 40, tipT: 1.95 }, { jibM: 45, tipT: 1.7 },
    { jibM: 50, tipT: 1.45 }, { jibM: 53.1, tipT: 1.15 },
  ],
};

// Linear interpolation of the tip load for an installed jib between two table rows. (given)
function tipLoadAt(model, jibM) {
  var p = model.tipLoadByJib;
  if (jibM <= p[0].jibM) return p[0].tipT;
  if (jibM >= p[p.length - 1].jibM) return p[p.length - 1].tipT;
  for (var i = 0; i < p.length - 1; i++) {
    var a = p[i], b = p[i + 1];
    if (jibM >= a.jibM && jibM <= b.jibM) {
      var f = (jibM - a.jibM) / (b.jibM - a.jibM);
      return a.tipT + f * (b.tipT - a.tipT);
    }
  }
  return p[p.length - 1].tipT;
}

// STARTER-KIT §1 — two-piece rule (implemented, not scaffold-throw):
// capacity(r) = maxCapacityT           for r <= cornerR   (cornerR = M / maxCapacityT)
// capacity(r) = M / r                  for r >  cornerR   (M = tipLoadAt(model,jibM) * jibM)
// return null if radiusM > jibM; return maxCapacityT if radiusM <= 0.
//
// ROUND 3 — SIMULATED PRODUCT RULE (wind derate, NOT verified against EN 14439):
// Optional 4th argument windKmh (km/h). The Round 3 ticket cites
// "0.8 derate at wind >= 20 km/h per EN 14439 Table 7", but the available
// project sources do not contain that table text, so the citation is
// unverified. Implemented as a product-requested simulation rule only:
//   windKmh undefined/null or < 20  -> return base capacity (unchanged)
//   windKmh >= 20                    -> return base capacity * 0.8
// Out-of-range (radiusM > jibM) still returns null, never a number.
// Tip table, moment M and corner radius are NOT modified; the factor applies
// to the final base rated capacity. Not a certified wind-load calculation.
function capacityAt(model, jibM, radiusM, windKmh) {
  var base;
  if (radiusM > jibM) return null;
  if (radiusM <= 0) {
    base = model.maxCapacityT;
  } else {
    var M = tipLoadAt(model, jibM) * jibM;
    var cornerR = M / model.maxCapacityT;
    if (radiusM <= cornerR) base = model.maxCapacityT;
    else base = M / radiusM;
  }
  if (windKmh === undefined || windKmh === null) return base;
  var w = Number(windKmh);
  if (!isFinite(w)) return base;
  if (w >= 20) return base * 0.8;
  return base;
}

// Validation harness (given). Fill `chart` with values READ from a real published chart.
function validate(model, jibM, chart, tolerancePct) {
  if (tolerancePct === undefined) tolerancePct = 10;
  console.log('Validating ' + model.label + ' @ ' + jibM + ' m jib');
  var worst = 0;
  for (var k = 0; k < chart.length; k++) {
    var row = chart[k];
    var mine = capacityAt(model, jibM, row.radiusM);
    if (mine == null) { console.log('  r=' + row.radiusM + 'm: OUT OF RANGE (radius > jib)'); continue; }
    var errPct = Math.abs(mine - row.chartT) / row.chartT * 100;
    worst = Math.max(worst, errPct);
    console.log('  r=' + row.radiusM + 'm: mine=' + mine.toFixed(2) + 't chart=' + row.chartT + 't err=' + errPct.toFixed(1) + '%');
  }
  console.log(worst <= tolerancePct ? 'PASS (worst ' + worst.toFixed(1) + '%)' : 'FAIL (worst ' + worst.toFixed(1) + '%)');
  return worst;
}

// Auto jib suggestion — returns shortest installed jib from table that can carry
// loadT at radiusM with 15% safety margin (loadT <= ratedCapacity * 0.85).
// Returns jibM (number) or null if no installed jib qualifies.
function suggestJib(model, loadT, radiusM, windKmh) {
  if (!model || !Array.isArray(model.tipLoadByJib) || model.tipLoadByJib.length === 0) return null;
  if (!isFinite(loadT) || loadT <= 0) return null;
  if (!isFinite(radiusM) || radiusM <= 0) return null;

  var w = windKmh;
  if (w !== undefined && w !== null && !isFinite(w)) w = undefined;

  var jibs = model.tipLoadByJib.slice().sort(function (a, b) { return a.jibM - b.jibM; });

  for (var i = 0; i < jibs.length; i++) {
    var jibM = jibs[i].jibM;
    if (radiusM > jibM) continue;
    var cap = capacityAt(model, jibM, radiusM, w);
    if (cap == null) continue;
    if (loadT <= cap * 0.85) return jibM;
  }
  return null;
}

// Ground-position point-in-rectangle for the exclusion-zone check (STARTER-KIT §6).
function hookInZone(hookX, hookZ, zone /* {x0,z0,x1,z1} */) {
  return hookX >= Math.min(zone.x0, zone.x1) && hookX <= Math.max(zone.x0, zone.x1)
      && hookZ >= Math.min(zone.z0, zone.z1) && hookZ <= Math.max(zone.z0, zone.z1);
}
