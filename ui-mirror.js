/* ui-mirror.js — READ-ONLY display mirrors for the dashboard shell.
   Copies text already computed by script.js into the sidebar/topbar/viewport
   mini-displays. Forwards sidebar clicks to the existing tab buttons (so the
   real tab-switch handler in script.js runs unchanged, including resize()).
   Never writes simulation state, never recomputes physics, never changes
   thresholds. Every access is guarded: missing elements are skipped. */
(function () {
'use strict';

function $(id) { return document.getElementById(id); }
function txt(id) { var e = $(id); return e ? e.textContent.trim() : ''; }

/* Risk level owned by script.js: .high = DANGER, .mid = WARNING, else SAFE. */
function riskLevel() {
  var b = $('riskBadge');
  if (!b) return 'ok';
  if (b.classList.contains('high')) return 'bad';
  if (b.classList.contains('mid')) return 'warn';
  return 'ok';
}

function setTone(el, level) {
  if (!el) return;
  el.classList.remove('tone-ok', 'tone-warn', 'tone-bad');
  el.classList.add('tone-' + level);
}

/* Sidebar navigation drives the existing (visually hidden) tab buttons,
   so script.js tab logic, chart redraw and resize() all run untouched. */
function wireSidebar() {
  var sideBtns = document.querySelectorAll('.sidenav button');
  if (!sideBtns.length) return;
  sideBtns.forEach(function (sb) {
    sb.addEventListener('click', function () {
      var tab = document.querySelector('.tabs button[data-tab="' + sb.getAttribute('data-side') + '"]');
      if (tab) tab.click();
    });
  });
}

/* Keep sidebar highlight + tab aria in sync with script.js tab state. */
function syncNav() {
  var active = document.querySelector('.tabs button.active');
  if (!active) return;
  var key = active.getAttribute('data-tab');
  document.querySelectorAll('.sidenav button').forEach(function (sb) {
    sb.classList.toggle('active', sb.getAttribute('data-side') === key);
  });
}

/* Append a PASS/FAIL status cell to each validation row, derived from the
   same per-row error value script.js already rendered (criterion ≤ 10%). */
var validPatched = false;
function patchValidation() {
  if (validPatched) return;
  var body = $('validationBody');
  if (!body || !body.rows || body.rows.length === 0) return;
  var done = true;
  Array.prototype.forEach.call(body.rows, function (tr) {
    if (tr.cells.length > 4) return; // already has a status cell
    var err = parseFloat((tr.cells[3].textContent || '').replace('%', ''));
    var pass = isFinite(err) ? err <= 10 : false;
    var td = document.createElement('td');
    var pill = document.createElement('span');
    pill.className = 'pill ' + (pass ? 'pass' : 'fail');
    pill.textContent = pass ? 'PASS' : 'FAIL';
    td.appendChild(pill);
    tr.appendChild(td);
    if (tr.cells.length < 5) done = false;
  });
  validPatched = done;
}

function mirror() {
  var level = riskLevel();

  /* Header mode mirrors the footer OP state written by script.js. */
  var hd = $('hdMode'), op = txt('stOp');
  if (hd && op) hd.textContent = op;

  /* Viewport corner mini-info mirrors live telemetry. */
  var vl = $('vpLoad'), vr = $('vpRadius'), vh = $('vpHook');
  var rl = txt('rLoad'), rr = txt('rRadius'), rh = txt('rHook');
  if (vl && rl) vl.textContent = rl;
  if (vr && rr) vr.textContent = rr;
  if (vh && rh) vh.textContent = rh;

  /* Corner-radius row mirrors the corner line written by script.js
     ("Corner radius: 16.2 m · Moment: …"). Falls back silently. */
  var rc = $('rCorner'), cl = txt('cornerLine');
  if (rc && cl) {
    var m = cl.match(/Corner radius:\s*([\d.]+)\s*m/);
    if (m) rc.textContent = m[1] + ' m';
  }

  /* Utilization row gets a warm/hot tone from the same risk level. */
  var rUtil = $('rUtil');
  if (rUtil && rUtil.parentElement && rUtil.parentElement.classList.contains('trow')) {
    rUtil.parentElement.classList.remove('warm', 'hot');
    if (level === 'bad') rUtil.parentElement.classList.add('hot');
    else if (level === 'warn') rUtil.parentElement.classList.add('warm');
  }

  /* Constraints-tab capacity line mirrors telemetry + risk state. */
  var cs = $('csCap'), cap = txt('rAllowed'), load = txt('rLoad');
  if (cs && (load || cap)) {
    var word = level === 'bad' ? 'CAPACITY EXCEEDED' : level === 'warn' ? 'HIGH UTILIZATION' : 'WITHIN LIMIT';
    cs.textContent = 'LOAD ' + (load || '—') + ' / ALLOW ' + (cap || '—') + ' — ' + word;
    setTone(cs, level);
  }

  syncNav();
  patchValidation();
}

/* Keep the Three.js canvas fitted when its flex frame changes size
   (e.g. warning banner shows/hides). Forwards to script.js resize(). */
var viewport = $('viewport');
if (viewport && 'ResizeObserver' in window) {
  var pending = false;
  new ResizeObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      window.dispatchEvent(new Event('resize'));
    });
  }).observe(viewport);
}

/* Light/dark theme toggle. UI-only; choice persists in localStorage. */
function wireTheme() {
  var btn = $('btnTheme');
  var root = document.documentElement;
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('tcdt-theme', theme); } catch (e) { /* private mode */ }
    if (btn) btn.textContent = theme === 'dark' ? '◑ LIGHT' : '◐ DARK';
  }
  var saved = null;
  try { saved = localStorage.getItem('tcdt-theme'); } catch (e) { /* private mode */ }
  apply(saved === 'dark' ? 'dark' : 'light');
  if (btn) btn.addEventListener('click', function () {
    apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

wireSidebar();
wireTheme();
mirror();
setInterval(mirror, 500);
})();
