import * as THREE from 'three';
import { PALETTE } from './palette';
import { buildTerrain, TERRAIN_CONFIG } from './terrain';
import { buildRoadNetwork, analyzeGraph, ROAD_CONFIG } from './roads';
import { buildArchetype, matchRootFile } from './archetypes';
import { makeSign, type BuildingHandle } from './buildings';
import { generateLayout, type CityLayout } from './layout';
import { planTraffic } from './trafficstops';
import { Traffic, TRAFFIC_CONFIG } from './traffic';
import type { CitySource } from './types';
import type { MapBounds } from './camera';

// --- City assembly tuning ------------------------------------------------------
export const CITY_CONFIG = {
  /** Founding time-lapse: terrain fade, road wave, building pop timings (s). */
  terrainFadeDuration: 0.6,
  roadWaveDuration: 1.4,
  buildingPopStart: 0.9,
  buildingWaveDuration: 2.2,
  towerRiseDuration: 0.5,
  /** Buildings shorter than this pop instantly instead of rising. */
  riseHeightThreshold: 2.5,
  /** Reduced-motion fallback: single fast fade duration (s). */
  reducedMotionFade: 0.25,
} as const;

/** Anything the render loop can host: demo map, showcase, or generated city. */
export interface ActiveWorld {
  scene: THREE.Scene;
  debugOverlay: THREE.Object3D | null;
  bounds: MapBounds;
  startTarget: THREE.Vector3;
  /** Island edge length in world units (drives camera framing). */
  worldSize: number;
  update: (dt: number) => void;
  dispose: () => void;
}

interface Tween {
  obj: THREE.Object3D;
  start: number;
  dur: number;
  mode: 'pop' | 'rise';
}

export interface BuiltCity {
  world: ActiveWorld;
  layout: CityLayout;
  source: CitySource;
  traffic: Traffic;
  /** Human-readable self-check report (also printed to console). */
  report: string;
  /** True when all graph gate assertions passed. */
  graphOk: boolean;
}

/** Assembles a full city scene from an ingested source. */
export function buildCity(source: CitySource): BuiltCity {
  const layout = generateLayout(source);
  const cc = CITY_CONFIG;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);

  const terrain = buildTerrain({
    mapTiles: layout.mapTiles,
    clearRect: {
      x0: layout.cityRect.x0 - 2,
      z0: layout.cityRect.z0 - 2,
      x1: layout.cityRect.x1 + 2,
      z1: layout.cityRect.z1 + 2,
    },
    ponds: layout.ponds.map((p) => ({ ...p.rect, shape: p.shape, seed: p.seed })),
  });
  scene.add(terrain.group);

  const roads = buildRoadNetwork(layout.segments, layout.bridges);
  scene.add(roads.group);

  // Plaza paving.
  const plazaW = layout.plaza.x1 - layout.plaza.x0 - 2;
  const plazaD = layout.plaza.z1 - layout.plaza.z0 - 2;
  const plazaGeo = new THREE.BoxGeometry(plazaW, 0.06, plazaD);
  const plazaMat = new THREE.MeshBasicMaterial({ color: PALETTE.sidewalk });
  const plazaPad = new THREE.Mesh(plazaGeo, plazaMat);
  plazaPad.position.set(
    (layout.plaza.x0 + layout.plaza.x1) / 2,
    ROAD_CONFIG.surfaceY,
    (layout.plaza.z0 + layout.plaza.z1) / 2,
  );
  scene.add(plazaPad);

  // Buildings + signs.
  const handles: BuildingHandle[] = [];
  const tweens: Tween[] = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plazaCX = (layout.plaza.x0 + layout.plaza.x1) / 2;
  const plazaCZ = (layout.plaza.z0 + layout.plaza.z1) / 2;
  const maxDist = Math.hypot(layout.mapTiles, layout.mapTiles) / 2;

  layout.lots.forEach((lot, lotIndex) => {
    const building = buildArchetype(lot.archetypeId, {
      path: lot.path === '' ? lot.signText : lot.path,
      fileCount: lot.fileCount + lot.mergedCount * 2,
      maxFootprint: lot.footprint,
    });
    building.group.position.set(lot.x, 0, lot.z);
    building.group.rotation.y = lot.rotationY;
    building.group.userData.lotIndex = lotIndex; // click selection → lot
    scene.add(building.group);
    handles.push(building);

    // Sign near the door, just off the building's front corner.
    const toDoorX = lot.doorX - lot.x;
    const toDoorZ = lot.doorZ - lot.z;
    const len = Math.hypot(toDoorX, toDoorZ) || 1;
    const sign = makeSign(
      lot.signText,
      lot.x + (toDoorX / len) * (lot.footprint * 0.35) + 0.7,
      lot.z + (toDoorZ / len) * (lot.footprint * 0.35) + 0.4,
    );
    scene.add(sign.group);
    handles.push(sign);

    if (!reducedMotion) {
      const dist = Math.hypot(lot.x - plazaCX, lot.z - plazaCZ);
      const delay = cc.buildingPopStart + (dist / maxDist) * cc.buildingWaveDuration;
      // Estimate height from the group's bounding box lazily: use footprint as
      // a proxy — towers (tall archetypes) rise, small buildings pop.
      const tall =
        lot.archetypeId === 'office-tower' ||
        lot.archetypeId === 'apartment' ||
        lot.archetypeId === 'city-hall';
      tweens.push({
        obj: building.group,
        start: delay,
        dur: tall ? cc.towerRiseDuration : 0.001,
        mode: tall ? 'rise' : 'pop',
      });
      tweens.push({ obj: sign.group, start: delay + 0.1, dur: 0.001, mode: 'pop' });
      building.group.visible = false;
      sign.group.visible = false;
    }
  });

  // Road wave: strips appear outward from the plaza.
  if (!reducedMotion) {
    for (const child of roads.group.children) {
      if (child === roads.debugOverlay) continue;
      const dist = Math.hypot(child.position.x - plazaCX, child.position.z - plazaCZ);
      tweens.push({
        obj: child,
        start: cc.terrainFadeDuration * 0.5 + (dist / maxDist) * cc.roadWaveDuration,
        dur: 0.001,
        mode: 'pop',
      });
      child.visible = false;
    }
    // Terrain fade-in.
    terrain.groundMaterial.transparent = true;
    terrain.groundMaterial.opacity = 0;
  } else {
    terrain.groundMaterial.transparent = true;
    terrain.groundMaterial.opacity = 0;
  }

  // --- Graph gate: the riskiest code in the project gets a hard self-check. ---
  const graphReport = analyzeGraph(roads.graph);
  let doorFailures = 0;
  for (const lot of layout.lots) {
    let adjacent = false;
    for (const seg of layout.segments) {
      const along = seg.axis === 'x' ? lot.doorX : lot.doorZ;
      const cross = seg.axis === 'x' ? lot.doorZ : lot.doorX;
      if (
        Math.abs(cross - seg.c) <= ROAD_CONFIG.roadWidth &&
        along >= seg.a - 0.5 &&
        along <= seg.b + 0.5
      ) {
        adjacent = true;
        break;
      }
    }
    if (!adjacent) doorFailures++;
  }
  const connectedOk = graphReport.components === 1;
  const degreeOk = graphReport.danglingNodes.length === 0;
  const doorsOk = doorFailures === 0;
  const graphOk = connectedOk && degreeOk && doorsOk;
  const report = [
    `graph self-check: ${graphReport.nodeCount} nodes, ${graphReport.edgeCount} edges`,
    `  connected single component: ${connectedOk ? 'PASS' : `FAIL (${graphReport.components} components)`}`,
    `  no dangling nodes (degree >= 2): ${degreeOk ? 'PASS' : `FAIL (${graphReport.danglingNodes.length} dangling)`}`,
    `  every door adjacent to a road: ${doorsOk ? 'PASS' : `FAIL (${doorFailures} lots)`}`,
  ].join('\n');
  console.log(report);
  console.log(
    `density: ${layout.lots.length} buildings placed vs floor ${layout.stats.densityFloor} ` +
      `(${layout.stats.amenitiesRequested} amenities requested; population stays honest: ${layout.stats.fileCount})`,
  );
  // Placement trace: full list for small repos, summary + merges for large.
  if (layout.debugLines.length <= 80) {
    console.log(`[layout]\n${layout.debugLines.join('\n')}`);
  } else {
    const merges = layout.debugLines.filter((l) => !l.startsWith('lot:'));
    console.log(
      `[layout] ${layout.debugLines.length} placement events (${merges.length} merges/swaps):\n${merges.join('\n')}`,
    );
  }

  // --- Traffic: bound to real files, routed on the real graph. ---
  const assignments = planTraffic(source, layout, TRAFFIC_CONFIG.maxVehicles);
  const traffic = new Traffic(scene, assignments, layout, roads.graph);
  console.log(
    `traffic: ${traffic.vehicleCount()} vehicles bound to files (true file count ${layout.stats.fileCount})`,
  );

  // --- Per-frame update: founding animation + traffic; allocates nothing. ---
  let clock = 0;
  const fadeDur = reducedMotion ? CITY_CONFIG.reducedMotionFade : cc.terrainFadeDuration;
  const update = (dt: number): void => {
    clock += dt;
    if (terrain.groundMaterial.opacity < 1) {
      terrain.groundMaterial.opacity = Math.min(1, clock / fadeDur);
      if (terrain.groundMaterial.opacity >= 1) terrain.groundMaterial.transparent = false;
    }
    for (let i = 0; i < tweens.length; i++) {
      const tw = tweens[i];
      if (!tw || clock < tw.start) continue;
      if (!tw.obj.visible) tw.obj.visible = true;
      if (tw.mode === 'rise') {
        const t = Math.min(1, (clock - tw.start) / tw.dur);
        tw.obj.scale.y = 0.05 + 0.95 * t;
      }
    }
    traffic.update(dt);
  };

  const worldSize = layout.mapTiles * TERRAIN_CONFIG.tileSize;
  const world: ActiveWorld = {
    scene,
    debugOverlay: roads.debugOverlay,
    bounds: { minX: 0, maxX: worldSize, minZ: 0, maxZ: worldSize },
    startTarget: new THREE.Vector3(plazaCX, 0, plazaCZ),
    worldSize,
    update,
    dispose: () => {
      traffic.dispose();
      terrain.dispose();
      roads.dispose();
      plazaGeo.dispose();
      plazaMat.dispose();
      for (const h of handles) h.dispose();
      tweens.length = 0;
    },
  };
  return { world, layout, source, traffic, report, graphOk };
}

// Re-export for HUD landmark hints (which root files became plaza landmarks).
export { matchRootFile };
