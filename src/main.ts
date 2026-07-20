import * as THREE from 'three';
import './style.css';
import { buildDemoWorld, buildBuilderWorld } from './scene';
import { HomeScreen } from './home';
import type { CityLayout } from './layout';
import { CameraRig } from './camera';
import { RetroPipeline, retroBypass } from './retro';
import { buildCity, type ActiveWorld, type BuiltCity } from './city';
import { buildShowcase, showcaseRequested } from './showcase';
import { Hud } from './hud';
import { attachDropzone } from './dropzone';
import { scanGitHub, ScanError } from './github';
import { exampleSource, kitchenSinkSource } from './sources';
import { QueryPanel } from './query';
import { EditMode } from './editmode';
import { TRAFFIC_CONFIG } from './traffic';
import type { VehicleTypeId } from './trafficstops';
import type { CitySource } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

const canvas = document.createElement('canvas');
app.appendChild(canvas);

// Antialias OFF — the whole point is chunky pixels.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1); // low-res target does the scaling; no HiDPI supersampling

// --- Active world management -------------------------------------------------
let world: ActiveWorld = showcaseRequested() ? buildShowcase() : buildDemoWorld();
const rig = new CameraRig(world.bounds, world.startTarget);
// A hidden/collapsed window reports 0×0 at load; fall back to 16:9 so the
// retro pipeline never gets a NaN aspect (which poisons all later sizing).
const bootAspect = window.innerWidth / window.innerHeight;
const retro = new RetroPipeline(renderer, Number.isFinite(bootAspect) ? bootAspect : 16 / 9);
rig.setInternalResolution(retro.internalWidth, retro.internalHeight);
rig.frameWorld(world.worldSize, world.startTarget);

/** The generated city currently hosted (null for demo/showcase worlds). */
let currentCity: BuiltCity | null = null;
const queryPanel = new QueryPanel();
const editMode = new EditMode();
window.__repoCityEdits = () => editMode.placementCount();
// Debug/test handle: the instance itself (runtime inspection only).
(window as unknown as Record<string, unknown>).__repoCityEditMode = editMode;

/** Builder's Mode canvas layout, when the hosted world is the empty island. */
let builderLayout: CityLayout | null = null;

function swapWorld(next: ActiveWorld, city: BuiltCity | null): void {
  editMode.onCityChanged(); // sandbox edits are per-city; discard before dispose
  hud.setEditActive(false);
  builderLayout = null;
  world.dispose();
  world = next;
  currentCity = city;
  rig.setBounds(next.bounds);
  rig.frameWorld(next.worldSize, next.startTarget);
  queryPanel.setContext(
    city ? { layout: city.layout, source: city.source, traffic: city.traffic } : null,
  );
}

// --- HUD + ingestion -----------------------------------------------------------
declare global {
  interface Window {
    /** Debug/test handle: live vehicle count (read-only observability). */
    __repoCityVehicles?: () => number;
    /** Debug/test handle: first vehicle's world position. */
    __repoCityVehiclePos?: () => { x: number; z: number } | null;
    /** Debug/test handle: fleet positions/colors for variety verification. */
    __repoCityFleet?: (
      limit: number,
    ) => { x: number; z: number; color: string; lang: string }[];
    /** Debug/test handle: live player-placed piece count (read-only). */
    __repoCityEdits?: () => number;
  }
}

function foundCity(source: CitySource): void {
  try {
    const city = buildCity(source);
    swapWorld(city.world, city);
    window.__repoCityVehicles = () => city.traffic.vehicleCount();
    window.__repoCityVehiclePos = () => city.traffic.debugFirstPosition();
    window.__repoCityFleet = (limit) => city.traffic.debugFleet(limit);
    const s = city.layout.stats;
    hud.setPopulation(`Population ${s.fileCount.toLocaleString()}`);
    const truncNote = s.truncated ? ' — Metropolis! Showing the main districts.' : '';
    const mergeNote =
      s.buildingsMerged > 0 ? ` (${s.buildingsMerged} deep districts merged upward)` : '';
    hud.setStatus(
      `${source.displayName}: ${s.districtCount} districts, ${s.buildingsShown} buildings${mergeNote}${truncNote}` +
        (city.graphOk ? '' : ' — graph self-check FAILED, see console'),
      !city.graphOk,
    );
  } catch (err) {
    hud.setStatus(err instanceof Error ? err.message : 'Failed to found the city.', true);
  }
}

const hud = new Hud({
  onScan: (input) => {
    // Built-in kitchen-sink demo: type "metropolis" to found a city that
    // exercises every archetype at once (no network, clearly synthetic).
    const keyword = input.trim().toLowerCase();
    if (keyword === 'metropolis' || keyword === 'demo/metropolis') {
      foundCity(kitchenSinkSource());
      return;
    }
    hud.setStatus('Surveying the land…');
    scanGitHub(input).then(
      (source) => {
        foundCity(source);
      },
      (err: unknown) => {
        hud.setStatus(err instanceof ScanError ? err.message : 'Scan failed. Try again?', true);
      },
    );
  },
  onFound: foundCity,
  onExample: () => {
    // The example button founds the kitchen-sink metropolis: every archetype
    // at once, clearly synthetic, no network needed.
    foundCity(kitchenSinkSource());
  },
  onEditToggle: () => {
    if (currentCity) {
      editMode.setBadge('EDIT MODE — player sandbox, not repo data');
      const active = editMode.toggle(currentCity.world.scene, currentCity.layout);
      hud.setEditActive(active);
      hud.setStatus(
        active
          ? 'EDIT MODE: sandbox changes only — the repo view is untouched.'
          : 'Back to the honest repo view.',
      );
      return;
    }
    if (builderLayout) {
      editMode.setBadge("BUILDER'S MODE — your city, built by hand");
      const active = editMode.toggle(world.scene, builderLayout);
      hud.setEditActive(active);
      hud.setStatus(
        active ? "BUILDER'S MODE: place anything from the catalog." : 'Builder island.',
      );
      return;
    }
    hud.setStatus('Found a city first — or pick Build a City from the title screen.', true);
  },
  onHome: () => {
    if (editMode.active) {
      editMode.exit();
      hud.setEditActive(false);
    }
    home.show();
  },
});

/** Builder's Mode: an empty island, straight into Edit Mode — no scan. */
function enterBuilderMode(): void {
  const built = buildBuilderWorld();
  swapWorld(built.world, null);
  builderLayout = built.layout; // after swapWorld: it clears builderLayout
  editMode.setBadge("BUILDER'S MODE — your city, built by hand");
  editMode.toggle(built.world.scene, built.layout);
  hud.setEditActive(true);
  hud.setPopulation('');
  hud.setStatus("BUILDER'S MODE: place anything from the catalog.");
}

const home = new HomeScreen({
  onUpload: () => {
    hud.setStatus('Scan a repo or drop a folder to found a city.');
  },
  onBuilder: enterBuilderMode,
});
home.show();

// Title backdrop: the built-in example city founds itself live beneath the
// title — roads wave out, buildings pop, traffic drives — pure attract mode.
// Deliberately NOT set as currentCity: it can't be inspected or mistaken for
// a scanned repo (no population claim, no query context).
if (!showcaseRequested()) {
  swapWorld(buildCity(exampleSource()).world, null);
}

attachDropzone({
  onProgress: (n) => hud.setSurveying(n),
  onFolders: (folders) => {
    hud.addFolders(folders);
    hud.setStatus('Folders staged. FOUND CITY when ready!');
  },
  onError: (message) => hud.setStatus(message, true),
  onDragState: (active) => hud.showDropOverlay(active),
});

// --- Canvas letterboxing ---------------------------------------------------------
function fitCanvas(): void {
  const aspect = retro.internalWidth / retro.internalHeight;
  let w = window.innerWidth;
  let h = Math.round(w / aspect);
  if (h > window.innerHeight) {
    h = window.innerHeight;
    w = Math.round(h * aspect);
  }
  // A hidden/collapsed window can report zero size; a 0-height canvas breaks
  // all raycasting until the next resize. Keep the last real size instead.
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return;
  renderer.setSize(w, h);
}
window.addEventListener('focus', fitCanvas);
document.addEventListener('visibilitychange', fitCanvas);
fitCanvas();

// --- Input -----------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return; // typing, not driving
  switch (e.code) {
    case 'KeyQ':
      rig.rotate(1);
      break;
    case 'KeyE':
      rig.rotate(-1);
      break;
    case 'Equal': // "+" without shift on US layouts
    case 'NumpadAdd':
      rig.zoom(1);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      rig.zoom(-1);
      break;
    case 'KeyG':
      if (world.debugOverlay) world.debugOverlay.visible = !world.debugOverlay.visible;
      break;
    case 'KeyB':
      retroBypass.enabled = !retroBypass.enabled;
      break;
    case 'Escape':
      if (editMode.active) editMode.clearSelection();
      queryPanel.collapse(true);
      break;
    default:
      rig.onKeyDown(e.code);
  }
});
window.addEventListener('keyup', (e) => {
  rig.onKeyUp(e.code);
});
window.addEventListener('mousemove', (e) => {
  rig.onMouseMove(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
});
document.addEventListener('mouseleave', () => {
  rig.onMouseLeave();
});
window.addEventListener('resize', fitCanvas);

// --- Selection (click, not drag) ---------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let downX = 0;
let downY = 0;
canvas.addEventListener('mousedown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
function aimRaycaster(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, rig.camera);
}
canvas.addEventListener('mousemove', (e) => {
  if (!editMode.active) return;
  aimRaycaster(e.clientX, e.clientY);
  editMode.handleHover(raycaster);
});
canvas.addEventListener('mouseup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // a drag, not a click
  aimRaycaster(e.clientX, e.clientY);
  if (editMode.active) {
    // Edit Mode owns clicks (also in Builder's Mode, where there is no
    // currentCity at all): no query panel, so sandbox pieces can never be
    // presented as codebase data.
    editMode.handleClick(raycaster);
    return;
  }
  if (!currentCity) return; // demo/showcase worlds have nothing to inspect
  const hits = raycaster.intersectObjects(world.scene.children, true);
  for (const hit of hits) {
    // Vehicle: instanced body/trim mesh tagged with its type id.
    const typeId = hit.object.userData.vehicleType as VehicleTypeId | undefined;
    if (typeId !== undefined && hit.instanceId !== undefined) {
      const vehicle = currentCity.traffic.vehicleAt(typeId, hit.instanceId);
      if (vehicle !== null) {
        queryPanel.showVehicle(vehicle);
        return;
      }
    }
    // Building: walk up to the group tagged with its lot index.
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      const lotIndex = o.userData.lotIndex as number | undefined;
      if (lotIndex !== undefined) {
        queryPanel.showBuilding(lotIndex);
        return;
      }
    }
  }
  queryPanel.showRoster(); // clicked empty ground: back to the city roster
});

// --- Traffic speed control (pause / play / fast) -----------------------------------
const speedBar = document.createElement('div');
speedBar.className = 'speed-bar';
document.body.appendChild(speedBar);
const speedButtons: [string, number, string][] = [
  ['⏸', 0, 'Pause traffic'],
  ['▶', 1, 'Play'],
  ['⏩', TRAFFIC_CONFIG.fastMultiplier, 'Fast-forward'],
];
for (const [label, multiplier, title] of speedButtons) {
  const btn = document.createElement('button');
  btn.className = 'speed-btn' + (multiplier === 1 ? ' speed-btn-active' : '');
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', () => {
    if (currentCity) currentCity.traffic.speedMultiplier = multiplier;
    for (const other of speedBar.children) other.classList.remove('speed-btn-active');
    btn.classList.add('speed-btn-active');
  });
  speedBar.appendChild(btn);
}

// --- Render loop (allocation-free) --------------------------------------------
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastMs = performance.now();
let titleSpinTimer = 0;
function frame(nowMs: number): void {
  const dt = Math.min((nowMs - lastMs) / 1000, 0.1); // clamp tab-switch spikes
  lastMs = nowMs;
  // Title-screen turntable: while the home screen is up, slowly orbit the
  // backdrop city (the rig eases each quarter-turn into a smooth drift).
  if (home.isVisible() && !reducedMotionQuery.matches) {
    titleSpinTimer += dt;
    if (titleSpinTimer >= 8) {
      titleSpinTimer = 0;
      rig.rotate(1);
    }
  }
  world.update(dt);
  rig.update(dt, nowMs);
  retro.render(world.scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
