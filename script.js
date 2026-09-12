/* ============================================================
   TOWER CRANE — POTAIN MCT 88 SIMULATION (Cycle 2, starter kit)
   Data-driven engineering learning prototype.
   Plain (non-module) scripts on purpose: works when index.html is
   opened directly via file:// — no server needed.
   Requires the two Three.js CDN scripts + capacity.js in index.html.
   Physics: capacityAt() / hookInZone() from capacity.js (STARTER-KIT).
   Structure: createSite / createCrane / createBuildings /
   createLoad / animateCrane / updateCraneMovement /
   updateCollisionDetection / updateWind / updateUI /
   runAutomaticLift / resetSimulation / buildValidation / drawChart
   ============================================================ */
(function () {
'use strict';

// Surface errors visibly (helps when CDN is blocked / offline)
function showGlError(msg) {
  const el = document.getElementById('glError');
  if (el) { el.classList.remove('hidden'); el.innerHTML = msg; }
  const banner = document.getElementById('warningBanner');
  if (banner) { banner.className = 'warning-banner'; banner.textContent = '⚠ ' + msg.replace(/<[^>]*>/g, ''); }
}
window.addEventListener('error', function (e) {
  const f = String(e.filename || '');
  if (f.indexOf('script.js') !== -1 || f.indexOf('capacity.js') !== -1) showGlError('Script error: ' + e.message + ' — open DevTools (F12 → Console) for details.');
  else if (f.indexOf('three.min.js') !== -1 || f.indexOf('OrbitControls.js') !== -1) showGlError('Three.js CDN failed to load — check internet connection and reload.');
}, true);
if (typeof THREE === 'undefined') {
  showGlError('Could not load Three.js from CDN — connect to the internet and reload, or serve this folder locally. No crane can render without it.');
  return;
}

const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1622);
scene.fog = new THREE.Fog(0x0d1622, 140, 320);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 12, 0);

function resize() {
  const w = viewport.clientWidth || 800, h = viewport.clientHeight || 600;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x3a3a2a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// ---------- State (manual/trolley/slew simulated; capacity REAL via capacity.js) ----------
const S = {
  mode: 'manual', playing: true, speed: 1,
  hoist: 24, trolley: 20, slew: 0,          // actual (animated)
  tHoist: 24, tTrolley: 20, tSlew: 0,       // targets
  load: 2.0, jibLen: 30, wind: 'moderate',
  obstaclesOn: true, exclOn: true,
  crane2Mode: 'on', config: 'standard',
  autoStep: -1, autoTimer: 0, attached: false, autoHold: null,
  target: { building: 'A', floor: 8 },
  conflicts: [], risk: 'low', time: 0,
  exclHit: null, bldgHit: null, bldgNear: null,
  cap: null, util: null, moment: null, corner: null,
};

/* ============================================================
   CYCLE 2 — REAL CRANE per Cycle-2 starter kit (STARTER-KIT.md).
   Potain MCT 88 (C25). Physics lives in capacity.js:
     MCT88 / tipLoadAt / capacityAt / validate / hookInZone.
   30 m validation config: tip 2.70 t -> M = 81 t·m,
   corner = 81/5 = 16.2 m.
   Real per-radius chart points (MCT 88 Data Sheet FEM 1.001-A3,
   "Load charts" page, 98 ft row ~30 m, upper 5.5-USt line;
   imperial -> metric, see SOURCES.md):
     66 ft (20.1 m) -> 4.3 USt = 3.90 t
     82 ft (25.0 m) -> 3.3 USt = 2.99 t
     98 ft (29.9 m) -> 2.8 USt = 2.54 t
   ============================================================ */
const CHART30 = [
  { radiusM: 20.1, chartT: 3.90 },
  { radiusM: 25.0, chartT: 2.99 },
  { radiusM: 29.9, chartT: 2.54 },
];
function capNow(r) { return capacityAt(MCT88, S.jibLen, r); }
function momentNow() { return tipLoadAt(MCT88, S.jibLen) * S.jibLen; }
function cornerNow() { return momentNow() / MCT88.maxCapacityT; }
function pctErr(model, real) { return real > 0 ? Math.abs(model - real) / real * 100 : 0; }
const MAST_TOP = () => (S.config === 'tall' ? 56 : 48);
const WIND_AMP = () => (S.wind === 'low' ? 0.15 : S.wind === 'moderate' ? 0.5 : 1.4);

// ---------- Label sprites ----------
const labelGroup = new THREE.Group(); scene.add(labelGroup);
function makeLabel(text, scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,14,22,0.85)'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#f5a623'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 60);
  g.fillStyle = '#fff'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(8 * scale, 2 * scale, 1);
  labelGroup.add(sp);
  return sp;
}
function tag(sprite, x, y, z) { sprite.position.set(x, y, z); return sprite; }

// ---------- Materials ----------
const M = {
  craneYellow: new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.5, metalness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.7 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8a97a5, roughness: 0.4, metalness: 0.6 }),
  cable: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6fb7d6, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x5a5f4a, roughness: 1 }),
  loadWood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 }),
};

// ---------- createSite ----------
let zoneGroup, envelopeGroup, windGroup;
const PICKUP = new THREE.Vector3(20, 0, 14);
function createSite() {
  // Ground
  const g = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), M.ground);
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  const grid = new THREE.GridHelper(160, 32, 0x29b6f6, 0x2b3a4e);
  grid.position.y = 0.02; scene.add(grid);

  // Site boundary fence
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xd35400 });
  const B = 65;
  [[0, -B, 2 * B, 1], [0, B, 2 * B, 1], [-B, 0, 1, 2 * B], [B, 0, 1, 2 * B]].forEach(([x, z, w, d]) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), fenceMat);
    f.position.set(x, 1, z); scene.add(f);
  });
  tag(makeLabel('SITE BOUNDARY', 0.9), B - 6, 3.4, 0);

  zoneGroup = new THREE.Group(); scene.add(zoneGroup);
  envelopeGroup = new THREE.Group(); scene.add(envelopeGroup);

  // Crane operating envelope (transparent disc, radius = installed jib; MCT 88 validation jib 30 m)
  const env = new THREE.Mesh(
    new THREE.CylinderGeometry(30, 30, 0.3, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  );
  env.position.y = 0.2; env.name = 'envelope'; envelopeGroup.add(env);
  const ring = new THREE.Mesh(new THREE.RingGeometry(29.6, 30.2, 64),
    new THREE.MeshBasicMaterial({ color: 0x29b6f6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; envelopeGroup.add(ring);
  tag(makeLabel('CRANE OPERATING ENVELOPE', 1.1), 21, 1.5, 21);

  // Exclusion zones
  function exclBox(x, z, w, d, label) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d),
      new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.22 }));
    m.position.set(x, 0.25, z); m.userData.zone = label; zoneGroup.add(m);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color: 0xe74c3c }));
    edge.position.copy(m.position); zoneGroup.add(edge);
    tag(makeLabel(label, 0.8), x, 1.6, z);
  }
  exclBox(0, 0, 18, 18, 'EXCLUSION ZONE — CRANE BASE');
  exclBox(19, -3, 10, 10, 'STORAGE AREA');
  exclBox(PICKUP.x, PICKUP.z, 10, 10, 'PICKUP ZONE');
  exclBox(0, -58, 30, 8, 'DELIVERY / UNLOADING');

  // Crane base exclusion cylinder
  const cz = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.35, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  cz.position.y = 0.3; cz.userData.zone = 'EXCLUSION ZONE — CRANE BASE'; zoneGroup.add(cz);

  // Storage crates (inside the storage rect x[14,24] z[-8,2])
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.6), M.loadWood);
    c.position.set(15.5 + (i % 4) * 2.5, 0.7, -6 + Math.floor(i / 4) * 2.5);
    c.castShadow = true; scene.add(c);
  }
  tag(makeLabel('STORAGE AREA', 0.9), 19, 3.4, -3);

  // Delivery trucks (simple visual)
  function truck(x, z, color) {
    const grp = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 2.4), new THREE.MeshStandardMaterial({ color }));
    cab.position.y = 1.4; cab.castShadow = true; grp.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 2.4), M.dark);
    bed.position.set(-4, 1.1, 0); bed.castShadow = true; grp.add(bed);
    grp.position.set(x, 0, z); scene.add(grp);
  }
  truck(-8, -56, 0x2980b9); truck(10, -56, 0x27ae60);
  tag(makeLabel('DELIVERY / UNLOADING', 0.9), 0, 4, -58);

  // Pickup pad
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x27ae60 }));
  pad.position.set(PICKUP.x, 0.15, PICKUP.z); pad.receiveShadow = true; scene.add(pad);

  // Wind arrows
  windGroup = new THREE.Group(); scene.add(windGroup);
  for (let i = 0; i < 6; i++) {
    const arr = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
    shaft.rotation.z = Math.PI / 2; arr.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.8, 10),
      new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
    head.rotation.z = -Math.PI / 2; head.position.x = 3.8; arr.add(head);
    arr.position.set(-50 + i * 6, 52, -40);
    windGroup.add(arr);
  }
  tag(makeLabel('WIND →', 0.8), -30, 54, -40);
}

// ---------- createBuildings ----------
const buildings = {}; // key -> {group, box:THREE.Box3 base footprint, floors, floorH, center}
function makeBuilding(key, x, z, w, d, floors, color) {
  const grp = new THREE.Group();
  const floorH = 3;
  for (let f = 0; f < floors; f++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d),
      new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.85 }));
    slab.position.y = f * floorH + floorH; slab.castShadow = slab.receiveShadow = true; grp.add(slab);
    if (f < floors - 1 || true) {
      const glazing = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, floorH - 0.6, d * 0.92), M.glass);
      glazing.position.y = f * floorH + floorH - floorH / 2 + 0.2; grp.add(glazing);
    }
    // columns
    [[-w / 2 + 0.5, -d / 2 + 0.5], [w / 2 - 0.5, -d / 2 + 0.5], [-w / 2 + 0.5, d / 2 - 0.5], [w / 2 - 0.5, d / 2 - 0.5]].forEach(([cx, cz]) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, floorH, 0.6), M.concrete);
      col.position.set(cx, f * floorH + floorH / 2 + 0.2, cz); col.castShadow = true; grp.add(col);
    });
  }
  // scaffold hints on top floor
  const scaf = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1),
    new THREE.MeshBasicMaterial({ color, wireframe: true }));
  scaf.position.y = floors * floorH + 1; grp.add(scaf);
  grp.position.set(x, 0, z); scene.add(grp);
  const H = floors * floorH + 0.5;
  const box = new THREE.Box3(
    new THREE.Vector3(x - w / 2, 0, z - d / 2),
    new THREE.Vector3(x + w / 2, H, z + d / 2));
  buildings[key] = { group: grp, box, floors, floorH, cx: x, cz: z, w, d, H };
  tag(makeLabel(`BUILDING ${key}`, 1.0), x, H + 3, z);
}
function createBuildings() {
  // Sited within the 30 m validation jib's reach (centres < ~26 m from mast)
  makeBuilding('A', 22, -12, 12, 12, 10, 0xe67e22);
  makeBuilding('B', -20, -14, 10, 10, 7, 0x8e44ad);
  makeBuilding('C', -12, 21, 12, 10, 12, 0x16a085);
}

// ---------- createCrane ----------
let slewGroup, trolleyMesh, ropeMesh, hookMesh, loadGroup, jibMesh, apexMesh;
let crane2Slew;
function mastSection(h) {
  const grp = new THREE.Group();
  const mat = M.craneYellow;
  const s = 1.6;
  [[-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), mat);
    leg.position.set(x, h / 2, z); leg.castShadow = true; grp.add(leg);
  });
  for (let y = 0.5; y < h; y += 1) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(s, 0.12, s), mat);
    rung.position.y = y; grp.add(rung);
  }
  return grp;
}
function createCrane() {
  const base = new THREE.Group(); scene.add(base);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), M.concrete);
  pad.position.y = 0.6; pad.receiveShadow = pad.castShadow = true; base.add(pad);
  tag(makeLabel('FOUNDATION / BASE', 0.8), 0, 2.4, 6);

  const nSec = 12, secH = 4;
  for (let i = 0; i < nSec; i++) {
    const sec = mastSection(secH); sec.position.y = 1.2 + i * secH; base.add(sec);
  }
  tag(makeLabel('MAST', 0.9), 0, 24, 2.5);

  slewGroup = new THREE.Group();
  slewGroup.position.y = 1.2 + nSec * secH; // ~49
  scene.add(slewGroup);

  const slew = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.6, 16), M.dark);
  slew.castShadow = true; slewGroup.add(slew);
  tag(makeLabel('SLEWING UNIT', 0.8), 0, slewGroup.position.y + 2.4, 3.4);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.6), new THREE.MeshStandardMaterial({ color: 0xecf0f1 }));
  cab.position.set(2.6, 2.2, 1.6); cab.castShadow = true; slewGroup.add(cab);
  const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 2.2), M.glass);
  cabGlass.position.set(2.6, 2.6, 1.6); slewGroup.add(cabGlass);
  const cabLabel = makeLabel('OPERATOR CAB', 0.75); slewGroup.add(cabLabel); cabLabel.position.set(2.6, 4.6, 1.6);

  // Apex tower
  apexMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 1.2), M.craneYellow);
  apexMesh.position.y = 5; apexMesh.castShadow = true; slewGroup.add(apexMesh);

  // Jib (extends +X)
  rebuildJib();

  // Counter-jib (-X) + counterweights
  const cj = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 1.6), M.craneYellow);
  cj.position.set(-7, 1.2, 0); cj.castShadow = true; slewGroup.add(cj);
  const cjLabel = makeLabel('COUNTER-JIB', 0.8); slewGroup.add(cjLabel); cjLabel.position.set(-7, 3.4, 0);
  for (let i = 0; i < 3; i++) {
    const cw = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 2.2), M.dark);
    cw.position.set(-11.5, 0.2, -1.5 + i * 1.5); cw.castShadow = true; slewGroup.add(cw);
  }
  const cwLabel = makeLabel('COUNTERWEIGHTS', 0.8); slewGroup.add(cwLabel); cwLabel.position.set(-11.5, 3.2, 0);

  // Trolley + rope + hook + load
  trolleyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.8), M.dark);
  trolleyMesh.castShadow = true; slewGroup.add(trolleyMesh);
  const trLabel = makeLabel('TROLLEY', 0.7); slewGroup.add(trLabel); trLabel.name = 'trolleyTag';

  ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), M.cable);
  slewGroup.add(ropeMesh);
  hookMesh = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), M.steel);
  block.castShadow = true; hookMesh.add(block);
  const hookTip = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8), M.steel);
  hookTip.position.y = -0.9; hookTip.rotation.x = Math.PI; hookMesh.add(hookTip);
  slewGroup.add(hookMesh);
  const hookLabel = makeLabel('HOOK', 0.7); slewGroup.add(hookLabel); hookLabel.name = 'hookTag';

  createLoad();
  const jibLabel = makeLabel('JIB', 0.9); slewGroup.add(jibLabel); jibLabel.name = 'jibTag';

  // --- Second crane (simplified, distant) ---
  const c2 = new THREE.Group(); c2.position.set(-52, 0, 30); scene.add(c2);
  const m2 = new THREE.Mesh(new THREE.BoxGeometry(2, 34, 2), new THREE.MeshStandardMaterial({ color: 0x7f8c8d }));
  m2.position.y = 17; m2.castShadow = true; c2.add(m2);
  crane2Slew = new THREE.Group(); crane2Slew.position.y = 34; c2.add(crane2Slew);
  const j2 = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 1.2), new THREE.MeshStandardMaterial({ color: 0x95a5a6 }));
  j2.position.x = 8; crane2Slew.add(j2);
  const cj2 = new THREE.Mesh(new THREE.BoxGeometry(9, 1, 1.2), new THREE.MeshStandardMaterial({ color: 0x95a5a6 }));
  cj2.position.x = -8; crane2Slew.add(cj2);
  c2.userData.pos = new THREE.Vector3(-52, 0, 30);
  scene.userData.crane2 = c2;
  tag(makeLabel('CRANE 2 (SIM)', 0.9), -52, 40, 30);
  // interference zone disc
  const iz = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 0.25, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf39c12, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
  iz.position.set(-52, 0.2, 30); iz.name = 'crane2env'; scene.add(iz);
}
function rebuildJib() {
  if (jibMesh) { slewGroup.remove(jibMesh); }
  const L = S.jibLen;
  jibMesh = new THREE.Mesh(new THREE.BoxGeometry(L, 1.3, 1.5), M.craneYellow);
  jibMesh.position.set(L / 2, 1.2, 0); jibMesh.castShadow = true;
  slewGroup.add(jibMesh);
  // pendant bars to apex
  [[0.35], [0.7]].forEach(([f]) => {
    const x = L * f;
    const top = new THREE.Vector3(0, 8.6, 0), bot = new THREE.Vector3(x, 1.9, 0);
    const len = top.distanceTo(bot);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 6), M.steel);
    bar.position.copy(top.clone().add(bot).multiplyScalar(0.5));
    bar.lookAt(slewGroup.localToWorld(bot.clone()));
    bar.rotateX(Math.PI / 2);
    slewGroup.add(bar); bar.userData.pendant = true;
  });
  // remove old pendants beyond? keep simple: clear pendants each rebuild
  slewGroup.children.filter(o => o.userData.pendant && o !== jibMesh).length; // noop
  const env = envelopeGroup.getObjectByName('envelope');
  if (env) { env.scale.set(L / 30, 1, L / 30); }
}

// ---------- createLoad ----------
function createLoad() {
  loadGroup = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.8), M.loadWood);
  crate.castShadow = true; loadGroup.add(crate);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 0.3), M.dark);
  strap.position.y = 0.85; loadGroup.add(strap);
  slewGroup.add(loadGroup);
  const l = makeLabel('LOAD', 0.7); slewGroup.add(l); l.name = 'loadTag';
}

// ---------- Helpers: world positions ----------
const _v = new THREE.Vector3();
function hookWorld() {
  // trolley local (r, y) within slewGroup; slew rotation about Y
  const a = THREE.MathUtils.degToRad(S.slew);
  const r = S.trolley;
  return new THREE.Vector3(Math.cos(a) * r, S.hoist, -Math.sin(a) * r);
  // NOTE: three rotation.y positive CCW; mapping approximated for display consistency
}
function targetFor(buildingKey, floor) {
  const b = buildings[buildingKey];
  const ty = floor * b.floorH + 1.5; // example target height
  // approach point: face nearest crane (origin)
  const dirx = b.cx, dirz = b.cz;
  const len = Math.hypot(dirx, dirz);
  const ux = dirx / len, uz = dirz / len;
  const dist = len - Math.max(b.w, b.d) / 2 - 3; // stand-off 3 m (simulated)
  return { pos: new THREE.Vector3(ux * dist, ty, uz * dist), height: ty };
}
function polarFor(pos) {
  const r = Math.hypot(pos.x, pos.z);
  let slew = THREE.MathUtils.radToDeg(Math.atan2(-pos.z, pos.x));
  return { r, slew };
}

// ---------- updateCraneMovement ----------
function updateCraneMovement(dt) {
  const k = Math.min(1, dt * 2.2 * S.speed);
  if (S.mode === 'manual' || S.autoStep < 0) {
    S.slew += (S.tSlew - S.slew) * k;
    S.trolley += (S.tTrolley - S.trolley) * k;
    S.hoist += (S.tHoist - S.hoist) * k;
  } else {
    runAutomaticLift(dt);
  }
  // clamp (installed jib; trolley 4 m to jib-1 (simulated))
  S.trolley = THREE.MathUtils.clamp(S.trolley, 4, S.jibLen - 1);
  S.hoist = THREE.MathUtils.clamp(S.hoist, 1.5, MAST_TOP() - 1);
  // apply to scene
  const topY = slewGroup.position.y;
  slewGroup.rotation.y = THREE.MathUtils.degToRad(S.slew);
  trolleyMesh.position.set(S.trolley, 1.2, 0);
  const ropeTop = 0.8, hookY = S.hoist - topY; // local
  const ropeLen = Math.max(0.5, (topY + 0.8) - S.hoist + 0); // world-space approx
  const trolleyWorldY = topY + 0.8;
  const len = Math.max(0.5, trolleyWorldY - S.hoist);
  ropeMesh.scale.y = len;
  ropeMesh.position.set(S.trolley, trolleyWorldY - len / 2 - topY, 0);
  hookMesh.position.set(S.trolley, S.hoist - topY, 0);
  // sway (simulated wind)
  S.time += dt * S.speed;
  const amp = WIND_AMP() * (S.hoist < trolleyWorldY - 1 ? Math.min(1, len / 20) : 0);
  const sx = Math.sin(S.time * 1.4) * amp, sz = Math.cos(S.time * 1.1) * amp;
  loadGroup.position.set(S.trolley + sx, S.hoist - topY - 1.6, sz);
  // move attached label tags
  const tags = {};
  slewGroup.children.forEach(o => { if (o.name) tags[o.name] = o; });
  if (tags.trolleyTag) tags.trolleyTag.position.set(S.trolley, 3.2, 0);
  if (tags.hookTag) tags.hookTag.position.set(S.trolley, S.hoist - topY + 1.6, 0);
  if (tags.loadTag) tags.loadTag.position.copy(loadGroup.position).add(new THREE.Vector3(0, 1.8, 0));
  if (tags.jibTag) tags.jibTag.position.set(S.jibLen * 0.55, 3.2, 0);
  // crane 2 rotation
  if (S.crane2Mode === 'rotate') crane2Slew.rotation.y += dt * 0.3 * S.speed;
  else if (S.crane2Mode === 'on') crane2Slew.rotation.y = 0.5;
  // wind arrows drift
  windGroup.children.forEach((a, i) => {
    a.position.x += dt * (S.wind === 'high' ? 6 : S.wind === 'moderate' ? 2.5 : 1) * S.speed;
    if (a.position.x > 60) a.position.x = -60;
    const s = S.wind === 'high' ? 1.4 : S.wind === 'moderate' ? 1 : 0.7;
    a.scale.set(s, s, s);
  });
}

// ---------- Exclusion zones: REAL geometry via hookInZone() (capacity.js, STARTER-KIT §6) ----------
// Crane centre at (0,0). Hook ground XZ from hookWorld(). Rects only, per the
// provided hookInZone(hookX, hookZ, {x0,z0,x1,z1}). The base "circle" is a
// rect x[-9,9] z[-9,9] gated on hook height (y<12); Crane-2 keeps its real
// circle as a documented extra (not part of the starter-kit check).
const ZONE_RECTS = [
  { id: 'base', label: 'EXCLUSION ZONE — CRANE BASE', x0: -9, z0: -9, x1: 9, z1: 9, maxY: 12 },
  { id: 'storage', label: 'STORAGE AREA', x0: 14, z0: -8, x1: 24, z1: 2 },
];
const CRANE2_ZONE = { id: 'crane2', label: 'CRANE 2 INTERFERENCE ZONE', cx: -52, cz: 30, r: 26 };
function zoneHit(lp) {
  if (S.exclOn) {
    for (const z of ZONE_RECTS) {
      if (hookInZone(lp.x, lp.z, z) && (z.maxY === undefined || lp.y < z.maxY)) return z;
    }
    if (S.crane2Mode !== 'off' && Math.hypot(lp.x - CRANE2_ZONE.cx, lp.z - CRANE2_ZONE.cz) < CRANE2_ZONE.r) return CRANE2_ZONE;
  }
  return null;
}
function highlightZones(hit) {
  zoneGroup.children.forEach(o => {
    if (o.material && o.material.transparent && o.userData) {
      const lbl = o.userData.zone;
      if (!lbl) return;
      const isHit = hit && lbl === hit.label;
      o.material.opacity = isHit ? 0.5 : 0.22;
      if (o.material.color) o.material.color.setHex(isHit ? 0xff0000 : 0xe74c3c);
    }
  });
  const c2env = scene.getObjectByProperty('name', 'crane2env');
  if (c2env && c2env.material) {
    const isHit = hit && hit.id === 'crane2';
    c2env.material.opacity = isHit ? 0.35 : 0.12;
    c2env.material.color.setHex(isHit ? 0xff0000 : 0xf39c12);
  }
}

// Early-warning envelope (simulated): warn BEFORE the load enters the
// building volume so the operator can stop/adjust in time. Distances are
// example values, not certified clearances.
const BLDG_WARN_XY = 4.0;  // horizontal buffer (m) around footprint
const BLDG_WARN_TOP = 5.0; // vertical buffer (m) above roof
const BLDG_INSIDE_E = 0.8; // contact tolerance for the hard conflict test
function buildingClearance(lp, b) {
  const dx = Math.max(b.box.min.x - lp.x, 0, lp.x - b.box.max.x);
  const dz = Math.max(b.box.min.z - lp.z, 0, lp.z - b.box.max.z);
  const horiz = Math.hypot(dx, dz);
  const above = lp.y - b.box.max.y; // >0 means above roof
  const insideXZ = lp.x > b.box.min.x - BLDG_INSIDE_E && lp.x < b.box.max.x + BLDG_INSIDE_E &&
                   lp.z > b.box.min.z - BLDG_INSIDE_E && lp.z < b.box.max.z + BLDG_INSIDE_E;
  const inside = insideXZ && lp.y < b.box.max.y;
  const near = !inside && horiz < BLDG_WARN_XY && lp.y < b.box.max.y + BLDG_WARN_TOP;
  return { horiz, above, inside, near };
}

 // ---------- updateCollisionDetection: capacityAt + hookInZone + building boxes ----------
const banner = document.getElementById('warningBanner');
function updateCollisionDetection() {
  const p = hookWorld();
  const lp = p.clone(); lp.y -= 1; // load centre approx 1 m below hook
  const conf = [];
  const r = S.trolley, load = S.load;
  // Wired per starter kit: cap = capacityAt(MCT88, jibLen, radius)
  const cap = capNow(r);
  const M = momentNow(), corner = cornerNow();
  const util = (cap == null || cap <= 0) ? 999 : load / cap;
  S.cap = cap; S.util = util; S.moment = M; S.corner = corner;

  // --- Building check: hook/load world position vs simplified building boxes ---
  // SIMPLIFIED GEOMETRIC CHECK — NOT A CERTIFIED CLEARANCE ANALYSIS.
  // Two levels: (1) HARD CONFLICT when inside the volume (bad),
  // (2) EARLY WARNING when inside the 4 m / 5 m buffer (warn) — fires BEFORE contact.
  let bldgHit = null, bldgNear = null;
  if (S.obstaclesOn) {
    for (const [key, b] of Object.entries(buildings)) {
      const c = buildingClearance(lp, b);
      const approxFloor = Math.max(1, Math.min(b.floors, Math.round(lp.y / b.floorH)));
      if (c.inside) {
        bldgHit = { key, floor: approxFloor };
        conf.push({ type: 'bad', msg: `SIMULATED BUILDING CLEARANCE CONFLICT — load inside Building ${key} (~floor ${approxFloor})` });
      } else if (c.near) {
        // Keep the closest approach only, so the banner names one building.
        if (!bldgNear || c.horiz < bldgNear.horiz) bldgNear = { key, floor: approxFloor, horiz: c.horiz, above: c.above };
      } else if (c.above >= 0 && c.above < BLDG_WARN_TOP && c.horiz < BLDG_WARN_XY + 2) {
        if (!bldgNear || c.horiz < bldgNear.horiz) bldgNear = { key, floor: approxFloor, horiz: c.horiz, above: c.above };
      }
    }
    if (!bldgHit && bldgNear) {
      const where = bldgNear.above >= 0
        ? `${bldgNear.above.toFixed(1)} m above roof`
        : `~floor ${bldgNear.floor}`;
      conf.push({ type: 'warn', msg: `SIMULATED APPROACH WARNING — load ${bldgNear.horiz.toFixed(1)} m from Building ${bldgNear.key} (${where}) — slow / adjust path before conflict` });
    }
  }
  S.bldgHit = bldgHit; S.bldgNear = bldgNear;

  // --- Jib reach: radius beyond installed jib (capacityAt returns null there) ---
  if (cap == null) conf.push({ type: 'bad', msg: `DANGER — radius ${r.toFixed(1)} m beyond ${S.jibLen} m jib (out of chart)` });
  if (S.hoist < 2.2) conf.push({ type: 'warn', msg: 'SIMULATED WARNING — hook near ground' });

  // --- Exclusion-zone test via hookInZone() (STARTER-KIT §6, obstacle avoidance) ---
  const zh = zoneHit(lp);
  S.exclHit = zh;
  highlightZones(zh);
  if (zh) conf.push({ type: 'bad', msg: `EXCLUSION ZONE VIOLATION — ${zh.label}` });

  if (S.wind === 'high') conf.push({ type: 'warn', msg: 'SIMULATED WIND CONSTRAINT — HIGH wind (example status only)' });

  // --- Capacity badge logic (starter kit): >=1.0 danger, >=0.9 warning, else within ---
  if (cap != null) {
    if (util >= 1.0) conf.push({ type: 'bad', msg: `DANGER — load ${load.toFixed(2)} t ≥ capacity ${cap.toFixed(2)} t @ ${r.toFixed(1)} m` });
    else if (util >= 0.9) conf.push({ type: 'warn', msg: `WARNING — utilization ${(util * 100).toFixed(1)}% (load ${load.toFixed(2)} t / cap ${cap.toFixed(2)} t)` });
  }

  S.conflicts = conf;
  if (!conf.length) { banner.className = 'warning-banner hidden'; banner.textContent = ''; }
  else {
    const hasBad = conf.some(c => c.type === 'bad');
    banner.className = 'warning-banner' + (hasBad ? '' : ' warn');
    banner.textContent = '⚠ ' + conf[0].msg + (conf.length > 1 ? `  (+${conf.length - 1} more)` : '');
  }
  // Replaces the old placeholder risk heuristic completely.
  // Building proximity upgrades risk BEFORE contact: near = warning, inside = danger.
  S.risk = (cap == null || util >= 1.0) ? 'high' : (util >= 0.9 ? 'mid' : 'low');
  if (S.bldgHit) S.risk = 'high';
  else if (S.bldgNear && S.risk === 'low') S.risk = 'mid';
}

// ---------- updateWind: indicator only (visual in updateCraneMovement) ----------
function updateWind() { /* sway + arrows handled in movement; banner in collision */ }

// ---------- updateUI ----------
const $ = id => document.getElementById(id);
const STEPS = ['STEP 1 — PICKUP', 'STEP 2 — HOIST (LOWER)', 'STEP 3 — LOAD ATTACHED ✓', 'STEP 4 — HOISTING LOAD', 'STEP 5 — TROLLEY TRAVEL', 'STEP 6 — SLEWING TO TARGET', 'STEP 7 — CAPACITY + EXCLUSION CHECKS', 'STEP 8 — LOWERING TO FLOOR', 'STEP 9 — LOAD PLACED ✓', 'STEP 10 — HOOK RETURNING'];
let uiTick = 0;
function updateUI() {
  if (++uiTick % 6) return;
  $('vHoist').textContent = S.tHoist.toFixed(1) + ' m';
  $('vTrolley').textContent = S.tTrolley.toFixed(1) + ' m';
  $('vSlew').textContent = Math.round(S.tSlew) + '°';
  $('vLoad').textContent = S.load.toFixed(1) + ' t';
  $('vJib').textContent = S.jibLen + ' m';
  $('rLoad').textContent = S.load.toFixed(2) + ' t';
  $('rRadius').textContent = S.trolley.toFixed(2) + ' m';
  $('rHook').textContent = S.hoist.toFixed(1) + ' m';
  const rj = $('rJib'); if (rj) rj.textContent = S.jibLen + ' m';
  const rjt = $('rJibTop'); if (rjt) rjt.textContent = S.jibLen + ' m';
  const cl = $('cornerLine');
  if (cl) cl.textContent = `Corner radius: ${cornerNow().toFixed(1)} m · Moment: ${momentNow().toFixed(1)} t·m · Source: MCT 88 datasheet (see REAL CRANE tab).`;
  const cap = S.cap !== undefined && S.cap !== null ? S.cap : capNow(S.trolley);
  const M = S.moment !== undefined && S.moment !== null ? S.moment : momentNow();
  const ut = S.util !== undefined && S.util !== null ? S.util : (cap == null ? 999 : S.load / cap);
  $('rAllowed').textContent = cap == null ? 'OUT OF RANGE' : cap.toFixed(2) + ' t';
  $('rModel').textContent = M.toFixed(1) + ' t·m';
  $('rUtil').textContent = ut > 9 ? '—' : (ut * 100).toFixed(1) + '%';
  const badge = $('riskBadge');
  badge.className = 'risk ' + S.risk;
  if (S.risk === 'low') badge.textContent = `SAFE — ${(ut * 100).toFixed(1)}% of capacity`;
  else if (S.risk === 'mid') badge.textContent = `WARNING — ${(ut * 100).toFixed(1)}% of capacity`;
  else badge.textContent = cap == null ? 'DANGER — OUT OF RANGE' : `DANGER — load ≥ capacity`;
  const capLine = $('capStatusLine');
  if (capLine) {
    const st = S.risk === 'high' ? 'DANGER' : (S.risk === 'mid' ? 'WARNING' : 'SAFE');
    capLine.textContent = `STATUS: ${st} · LOAD ${S.load.toFixed(2)} t · RADIUS ${S.trolley.toFixed(2)} m · CAPACITY ${cap == null ? '—' : cap.toFixed(2) + ' t'} · UTIL ${ut > 9 ? '—' : (ut * 100).toFixed(1) + '%'}`;
  }
  // Constraints tab live text (STARTER-KIT §6 wording)
  const ex = $('exclStatus'), bl = $('bldgStatus');
  if (ex) ex.textContent = S.exclHit ? `EXCLUSION ZONE VIOLATION — ${S.exclHit.label}` : 'PATH CLEAR';
  if (bl) {
    if (S.bldgHit) bl.textContent = `SIMULATED BUILDING CLEARANCE CONFLICT — Building ${S.bldgHit.key} (~floor ${S.bldgHit.floor}). SIMPLIFIED GEOMETRIC CHECK — NOT A CERTIFIED CLEARANCE ANALYSIS.`;
    else if (S.bldgNear) bl.textContent = `SIMULATED APPROACH WARNING — ${S.bldgNear.horiz.toFixed(1)} m from Building ${S.bldgNear.key} (~floor ${S.bldgNear.floor}). Early-warning buffer ${BLDG_WARN_XY.toFixed(0)} m / +${BLDG_WARN_TOP.toFixed(0)} m — adjust path before conflict. SIMPLIFIED GEOMETRIC CHECK — NOT A CERTIFIED CLEARANCE ANALYSIS.`;
    else bl.textContent = 'BUILDING CLEARANCE: CLEAR. SIMPLIFIED GEOMETRIC CHECK — NOT A CERTIFIED CLEARANCE ANALYSIS.';
  }
  $('stCrane').textContent = S.playing ? 'ACTIVE' : 'PAUSED';
  $('stOp').textContent = S.mode === 'auto' ? ('AUTO STEP ' + (S.autoStep + 1) + '/10') : 'MANUAL';
  $('stLoad').textContent = S.load.toFixed(1) + ' t';
  $('stRadius').textContent = S.trolley.toFixed(1) + ' m';
  $('stHook').textContent = S.hoist.toFixed(1) + ' m';
  $('stSlew').textContent = Math.round(S.slew) + '°';
  $('stWind').textContent = S.wind.toUpperCase();
  if (S.mode === 'auto' && S.autoStep >= 0) {
    $('opStep').textContent = STEPS[Math.min(S.autoStep, 9)];
    $('liftBar').style.width = ((S.autoStep + 1) / 10 * 100) + '%';
  } else {
    $('liftBar').style.width = '0';
  }
}

// ---------- runAutomaticLift (uses REAL chart + geometric checks each stage) ----------
function startAutoLift() {
  S.mode = 'auto'; S.autoStep = 0; S.autoTimer = 0; S.attached = false; S.autoHold = null;
  S.playing = true;
  $('btnAuto').classList.add('active'); $('btnManual').classList.remove('active');
  $('opDetail').textContent = 'Automatic demonstration running… (PICKUP → HOIST → TROLLEY → SLEW → APPROACH → CHECKS → LOWER → PLACE)';
  syncModeButtons();
}
const AUTO_LABELS = ['1. PICKUP', '2. HOIST', '3. TROLLEY OUT', '4. SLEW', '5. APPROACH BUILDING', '6. CHECK CAPACITY', '7. CHECK EXCLUSION ZONE', '8. LOWER LOAD', '9. PLACE LOAD'];
function autoChecks(stageLabel) {
  // Starter-kit wiring: cap = capacityAt(MCT88, jibLen, radius); util = load/cap.
  const cap = capNow(S.trolley);
  const util = cap == null ? 999 : S.load / cap;
  if (cap == null || util >= 1.0) {
    S.autoHold = `DANGER (${stageLabel}) — load ${S.load.toFixed(2)} t vs capacity ${cap == null ? 'OUT OF RANGE' : cap.toFixed(2) + ' t'} @ ${S.trolley.toFixed(1)} m. Reduce load or radius to resume.`;
    $('opDetail').textContent = S.autoHold;
    return false;
  }
  if (S.exclHit) {
    S.autoHold = `EXCLUSION ZONE VIOLATION (${stageLabel}) — ${S.exclHit.label}. Adjust slew/radius to resume.`;
    $('opDetail').textContent = S.autoHold;
    return false;
  }
  // Prevent building contact: hard conflict always holds; early-warning holds
  // during travel (HOIST/TROLLEY/SLEW/CHECKS) but is allowed for the final
  // intentional LOWER/PLACE approach to the target building.
  if (S.bldgHit) {
    S.autoHold = `BUILDING CONFLICT (${stageLabel}) — load inside Building ${S.bldgHit.key} (~floor ${S.bldgHit.floor}). Adjust slew/radius/height to resume.`;
    $('opDetail').textContent = S.autoHold;
    return false;
  }
  const isFinalApproach = stageLabel === 'LOWER' || stageLabel === 'PLACE';
  if (S.bldgNear && !isFinalApproach) {
    S.autoHold = `BUILDING APPROACH HOLD (${stageLabel}) — ${S.bldgNear.horiz.toFixed(1)} m from Building ${S.bldgNear.key}. Path paused BEFORE conflict — adjust slew/radius/height to resume.`;
    $('opDetail').textContent = S.autoHold;
    return false;
  }
  S.autoHold = null;
  return true;
}
function runAutomaticLift(dt) {
  const tgt = targetFor(S.target.building, S.target.floor);
  const tp = polarFor(tgt.pos);
  const pick = polarFor(PICKUP);
  const topY = MAST_TOP();
  const travelH = Math.min(topY - 2, Math.max(tgt.pos.y + 10, 34)); // safe travel height (simulated)
  const spd = S.speed;
  const close = (a, b, e) => Math.abs(a - b) < e;
  let done = false;
  const mv = (h, r, s, eh = 0.6, er = 0.6, es = 3) => {
    // ease actual values toward given targets
    const k = Math.min(1, dt * 1.6 * spd);
    S.hoist += (h - S.hoist) * k; S.trolley += (r - S.trolley) * k;
    let ds = ((s - S.slew + 540) % 360) - 180;
    S.slew += ds * k;
    S.tHoist = h; S.tTrolley = r; S.tSlew = s;
    syncSliders();
    done = close(S.hoist, h, eh) && close(S.trolley, r, er) && Math.abs(ds) < es;
  };
  S.autoTimer += dt * spd;
  const liveTxt = () => {
    const c = capNow(S.trolley), u = c == null ? 999 : S.load / c;
    const bldg = S.bldgHit ? 'BLDG CONFLICT ' + S.bldgHit.key : (S.bldgNear ? `BLDG ${S.bldgNear.horiz.toFixed(1)}m→${S.bldgNear.key}` : 'BLDG CLEAR');
    return `LOAD ${S.load.toFixed(2)}t · R ${S.trolley.toFixed(1)}m · CAP ${c == null ? '—' : c.toFixed(2) + 't'} · UTIL ${u > 9 ? '—' : (u * 100).toFixed(0) + '%'} · ${S.exclHit ? 'EXCLUSION ZONE VIOLATION' : 'PATH CLEAR'} · ${bldg}`;
  };
  switch (S.autoStep) {
    case 0: mv(travelH, pick.r, pick.slew); $('opDetail').textContent = '1. PICKUP — load at green pad. ' + liveTxt(); if (done && S.autoTimer > 2) next(); break;
    case 1: mv(2.5, pick.r, pick.slew); $('opDetail').textContent = '2. HOIST (lower) — hook to load. ' + liveTxt(); if (done) next(); break;
    case 2: S.attached = true; $('opDetail').textContent = '3. RIGGING — load attached (simulated). ' + liveTxt(); if (S.autoTimer > 1.5) next(); break;
    case 3: mv(travelH, pick.r, pick.slew); $('opDetail').textContent = '4. HOIST UP — load clear of ground. ' + liveTxt(); if (done && autoChecks('HOIST')) next(); break;
    case 4: mv(travelH, tp.r, pick.slew); $('opDetail').textContent = '5. TROLLEY OUT — radius changing. ' + liveTxt(); if (done && autoChecks('TROLLEY')) next(); break;
    case 5: mv(travelH, tp.r, tp.slew); $('opDetail').textContent = '6. SLEW toward Building ' + S.target.building + '. ' + liveTxt(); if (done && autoChecks('SLEW')) next(); break;
    case 6: if (!autoChecks('CHECKS')) break; mv(travelH, tp.r, tp.slew); $('opDetail').textContent = `7. CHECKS — capacity + exclusion verified. ${liveTxt()}`; if (done && S.autoTimer > 1.5) next(); break;
    case 7: mv(tgt.pos.y + 1.2, tp.r, tp.slew); $('opDetail').textContent = `8. LOWER to Bldg ${S.target.building} F${S.target.floor} (${tgt.height.toFixed(1)} m). ${liveTxt()}`; if (done && autoChecks('LOWER')) next(); break;
    case 8: S.attached = false; $('opDetail').textContent = '9. PLACE — load placed (simulated). ' + liveTxt(); if (S.autoTimer > 2) next(); break;
    case 9: mv(travelH, tp.r, tp.slew); $('opDetail').textContent = 'Hook returning. Lift complete — replay or manual. ' + liveTxt(); if (done && S.autoTimer > 2) { S.autoStep = -1; S.mode = 'manual'; $('opStep').textContent = 'LIFT COMPLETE — MANUAL CONTROL'; syncModeButtons(); } break;
  }
  function next() { S.autoStep++; S.autoTimer = 0; if (S.autoStep > 9) { S.autoStep = -1; S.mode = 'manual'; $('opStep').textContent = 'LIFT COMPLETE — MANUAL CONTROL'; syncModeButtons(); } else $('opStep').textContent = STEPS[Math.min(S.autoStep, 9)]; }
}

// ---------- resetSimulation ----------
function resetSimulation() {
  S.tHoist = 24; S.tTrolley = 20; S.tSlew = 0; S.load = 2; S.jibLen = 30; // 30 m validation jib
  S.autoStep = -1; S.mode = 'manual'; S.autoHold = null;
  S.attached = false; S.conflicts = []; S.exclHit = null; S.bldgHit = null; S.bldgNear = null;
  S.cap = null; S.util = null;
  $('sHoist').value = 24; $('sTrolley').value = 20; $('sSlew').value = 0; $('sLoad').value = 2;
  $('sJib').value = 30; $('sTrolley').max = 29;
  [...slewGroup.children].filter(o => o.userData.pendant).forEach(o => slewGroup.remove(o));
  rebuildJib();
  drawChart();
  $('opStep').textContent = 'MANUAL — AWAITING INPUT';
  $('opDetail').textContent = 'Hoist / Trolley / Slew sliders are live';
  syncModeButtons();
}

// ---------- animateCrane ----------
const clock = new THREE.Clock();
function animateCrane() {
  requestAnimationFrame(animateCrane);
  const dt = Math.min(0.05, clock.getDelta());
  if (S.playing) updateCraneMovement(dt);
  updateCollisionDetection();
  updateWind(); updateUI();
  controls.update();
  renderer.render(scene, camera);
}

// ---------- Camera presets ----------
function setCam(name) {
  const t = controls.target;
  if (name === 'top') { camera.position.set(0, 150, 0.1); t.set(0, 0, 0); }
  if (name === 'persp') { camera.position.set(70, 55, 75); t.set(0, 12, 0); }
  if (name === 'site') { camera.position.set(-95, 40, -95); t.set(0, 8, 0); }
  if (name === 'crane') { camera.position.set(14, MAST_TOP() + 4, 14); t.set(0, MAST_TOP() - 6, 0); }
  if (name === 'hook') { const p = hookWorld(); camera.position.set(p.x + 12, p.y + 8, p.z + 12); t.set(p.x, p.y, p.z); }
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('active', b.dataset.cam === name));
}

// ---------- UI wiring ----------
function syncSliders() {
  $('sHoist').value = S.tHoist; $('sTrolley').value = S.tTrolley; $('sSlew').value = S.tSlew;
}
function syncModeButtons() {
  $('btnManual').classList.toggle('active', S.mode === 'manual');
  $('btnAuto').classList.toggle('active', S.mode === 'auto');
}
function refreshFloors() {
  const b = buildings[S.target.building]; const sel = $('selFloor'); sel.innerHTML = '';
  for (let f = 1; f <= b.floors; f++) { const o = document.createElement('option'); o.value = f; o.textContent = 'Floor ' + f; sel.appendChild(o); }
  sel.value = Math.min(S.target.floor, b.floors); S.target.floor = +sel.value;
  updateTargetInfo();
}
function updateTargetInfo() {
  const t = targetFor(S.target.building, S.target.floor);
  $('targetInfo').textContent = `BUILDING: ${S.target.building} · FLOOR: ${S.target.floor} · TARGET HEIGHT: Example ${t.height.toFixed(1)} m · Material placement`;
}
function wireUI() {
  $('sHoist').addEventListener('input', e => { S.tHoist = +e.target.value; if (S.mode === 'auto') { S.mode = 'manual'; S.autoStep = -1; syncModeButtons(); } });
  $('sTrolley').addEventListener('input', e => { S.tTrolley = +e.target.value; if (S.mode === 'auto') { S.mode = 'manual'; S.autoStep = -1; syncModeButtons(); } });
  $('sSlew').addEventListener('input', e => { S.tSlew = +e.target.value; if (S.mode === 'auto') { S.mode = 'manual'; S.autoStep = -1; syncModeButtons(); } });
  $('sLoad').addEventListener('input', e => { S.load = +e.target.value; });
  $('sJib').addEventListener('input', e => {
    S.jibLen = +e.target.value;
    $('sTrolley').max = S.jibLen - 1;
    if (S.tTrolley > S.jibLen - 1) { S.tTrolley = S.jibLen - 1; syncSliders(); }
    // drop pendants then rebuild
    [...slewGroup.children].filter(o => o.userData.pendant).forEach(o => slewGroup.remove(o));
    rebuildJib();
    drawChart();
  });
  $('selWind').addEventListener('change', e => S.wind = e.target.value);
  $('selCrane2').addEventListener('change', e => {
    S.crane2Mode = e.target.value;
    scene.userData.crane2.visible = S.crane2Mode !== 'off';
    scene.getObjectByProperty('name', 'crane2env').visible = S.crane2Mode !== 'off';
  });
  $('selObstacles').addEventListener('change', e => S.obstaclesOn = e.target.value === 'on');
  $('selExcl').addEventListener('change', e => S.exclOn = e.target.value === 'on');
  $('selGate').addEventListener('change', e => { $('opDetail').textContent = 'Site gate: ' + e.target.value.toUpperCase() + ' (simulated access state)'; });
  $('selConfig').addEventListener('change', e => {
    S.config = e.target.value;
    if (S.config === 'short') { S.jibLen = 20; $('sJib').value = 20; $('sTrolley').max = 19; [...slewGroup.children].filter(o => o.userData.pendant).forEach(o => slewGroup.remove(o)); rebuildJib(); drawChart(); }
    if (S.config === 'standard') { S.jibLen = 30; $('sJib').value = 30; $('sTrolley').max = 29; [...slewGroup.children].filter(o => o.userData.pendant).forEach(o => slewGroup.remove(o)); rebuildJib(); drawChart(); }
  });
  // Tabs (Cycle 2 panels — simulation stays default)
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('active', p.dataset.page === b.dataset.tab));
    if (b.dataset.tab === 'chart') drawChart();
    resize();
  }));
  $('tZones').addEventListener('change', e => zoneGroup.visible = e.target.checked);
  $('tEnvelope').addEventListener('change', e => envelopeGroup.visible = e.target.checked);
  $('tLabels').addEventListener('change', e => {
    labelGroup.visible = e.target.checked;
    slewGroup.traverse(o => { if (o.isSprite) o.visible = e.target.checked; });
  });
  $('tWind').addEventListener('change', e => windGroup.visible = e.target.checked);
  $('btnPlay').addEventListener('click', () => S.playing = true);
  $('btnPause').addEventListener('click', () => S.playing = false);
  $('btnReset').addEventListener('click', resetSimulation);
  $('btnManual').addEventListener('click', () => { S.mode = 'manual'; S.autoStep = -1; $('opStep').textContent = 'MANUAL — AWAITING INPUT'; syncModeButtons(); });
  $('btnAuto').addEventListener('click', startAutoLift);
  $('btnDemoLift').addEventListener('click', startAutoLift);
  document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', () => {
    S.speed = +b.dataset.speed;
    document.querySelectorAll('.speed-btn').forEach(x => x.classList.toggle('active', x === b));
  }));
  document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('selBuilding').addEventListener('change', e => { S.target.building = e.target.value; refreshFloors(); });
  $('selFloor').addEventListener('change', e => { S.target.floor = +e.target.value; updateTargetInfo(); });
  $('btnGotoFloor').addEventListener('click', () => {
    const t = targetFor(S.target.building, S.target.floor); const p = polarFor(t.pos);
    S.tTrolley = Math.min(p.r, S.jibLen - 1); S.tSlew = p.slew; S.tHoist = t.pos.y + 1.2;
    S.mode = 'manual'; S.autoStep = -1; syncModeButtons(); syncSliders();
    $('opStep').textContent = `MANUAL GUIDE → BLDG ${S.target.building} F${S.target.floor}`;
    $('opDetail').textContent = `Target example height ${t.height.toFixed(1)} m. Sliders pre-set — press PLAY if paused.`;
  });
}

// ---------- Validation table + load-chart canvas (capacityAt vs real points) ----------
function buildValidation() {
  const body = $('validationBody');
  if (!body) return;
  body.innerHTML = '';
  let worst = 0;
  const rows = [];
  CHART30.forEach(pt => {
    const model = capacityAt(MCT88, 30, pt.radiusM);
    const err = pctErr(model, pt.chartT);
    worst = Math.max(worst, err);
    rows.push({ r: pt.radiusM, real: pt.chartT, model, err });
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${pt.radiusM.toFixed(1)} m</td><td>${pt.chartT.toFixed(2)} t</td><td>${model.toFixed(2)} t</td><td>${err.toFixed(1)} %</td>`;
    body.appendChild(tr);
  });
  const sum = $('vSummary'), st = $('vStatus');
  if (sum) sum.textContent = `MAX ERROR: ${worst.toFixed(1)} % · TARGET ≤ 10% · 30 m jib, radii 20.1 / 25.0 / 29.9 m`;
  if (st) {
    const ok = worst <= 10;
    st.className = 'risk ' + (ok ? 'low' : 'high');
    st.textContent = ok ? 'PASS — VALIDATED WITHIN TARGET' : 'FAIL — MODEL REQUIRES REFINEMENT';
  }
  const w = $('workedExample');
  if (w) {
    w.textContent = `Manual validation example — 30 m jib: tip load 2.70 t → M = 2.70 × 30 = 81 t·m → corner = 81/5 = 16.2 m → capacity(20 m) = 81/20 = 4.05 t. ` +
      `Table errors: ${rows.map(x => `${x.r.toFixed(1)}m ${x.err.toFixed(1)}%`).join(' · ')} → worst ${worst.toFixed(1)}%.`;
  }
  return worst;
}
function drawChart() {
  const cv = $('loadChart');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = { l: 44, r: 10, t: 12, b: 30 };
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f1720'; ctx.fillRect(0, 0, W, H);
  const jib = S.jibLen, MM = momentNow(), corner = cornerNow();
  const xs = [0, Math.max(32, jib + 2)], ys = [0, 6];
  const X = r => pad.l + (r - xs[0]) / (xs[1] - xs[0]) * (W - pad.l - pad.r);
  const Y = c => H - pad.b - (c - ys[0]) / (ys[1] - ys[0]) * (H - pad.t - pad.b);
  ctx.strokeStyle = '#2b3a4e'; ctx.fillStyle = '#93a5b8'; ctx.font = '10px Arial'; ctx.lineWidth = 1;
  for (let r = 0; r <= xs[1]; r += 5) { ctx.beginPath(); ctx.moveTo(X(r), pad.t); ctx.lineTo(X(r), H - pad.b); ctx.stroke(); ctx.fillText(r + 'm', X(r) - 8, H - 12); }
  for (let c = 0; c <= 6; c += 1) { ctx.beginPath(); ctx.moveTo(pad.l, Y(c)); ctx.lineTo(W - pad.r, Y(c)); ctx.stroke(); ctx.fillText(c + 't', 12, Y(c) + 3); }
  ctx.fillText('Working Radius (m) →', W / 2 - 50, H - 1);
  // capacityAt model (dashed amber): flat to corner, then M/r, null beyond jib
  ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
  let started = false;
  for (let r = 0.5; r <= jib; r += 0.25) {
    const c = capacityAt(MCT88, jib, r);
    const x = X(r), y = Y(c);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.setLineDash([]);
  // Corner marker
  ctx.strokeStyle = '#f5a623'; ctx.beginPath(); ctx.moveTo(X(corner), pad.t); ctx.lineTo(X(corner), H - pad.b); ctx.stroke();
  ctx.fillStyle = '#f5a623'; ctx.fillText('corner ' + corner.toFixed(1) + 'm', X(corner) - 34, pad.t + 10);
  // Real manufacturer points (solid green; only meaningful near 30 m jib)
  ctx.fillStyle = '#2ecc71';
  const pts = (Math.abs(jib - 30) < 0.01) ? CHART30 : [];
  pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p.radiusM), Y(p.chartT), 3.5, 0, 7); ctx.fill(); });
  // Current operating point (white ring)
  const cc = capNow(S.trolley);
  if (cc != null) {
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(X(S.trolley), Y(Math.min(cc, ys[1])), 5, 0, 7); ctx.stroke();
  }
  // Tip marker: model must pass through published tip
  const tip = tipLoadAt(MCT88, jib);
  ctx.fillStyle = '#93a5b8'; ctx.fillText(`M=${MM.toFixed(1)} tip=${tip.toFixed(2)}t`, pad.l + 4, pad.t + 10);
}

// ---------- Boot ----------
try {
  if (typeof capacityAt !== 'function' || typeof hookInZone !== 'function' || typeof MCT88 === 'undefined') {
    throw new Error('capacity.js did not load — MCT88/capacityAt/hookInZone missing. Keep capacity.js next to index.html.');
  }
  if (!renderer.capabilities) throw new Error('WebGL unavailable');
  createSite();
  createBuildings();
  createCrane();
  wireUI();
  refreshFloors();
  setCam('persp');
  syncModeButtons();
  buildValidation();
  drawChart();
  // TEST 9 — validation harness in the console (real chart points, 30 m jib)
  try { validate(MCT88, 30, CHART30, 10); } catch (e) { console.warn('validate() failed:', e.message); }
  // Resize twice: once now, once after layout settles (flex sizing on file://)
  resize();
  requestAnimationFrame(resize);
  window.addEventListener('load', resize);
  animateCrane();
} catch (err) {
  showGlError('Failed to start 3D scene: ' + err.message + ' — try Chrome/Edge with hardware acceleration on.');
}

})();
