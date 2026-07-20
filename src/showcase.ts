import * as THREE from 'three';
import { PALETTE } from './palette';
import { buildTerrain, TERRAIN_CONFIG } from './terrain';
import { ARCHETYPES, buildArchetype } from './archetypes';
import { makeSign, type BuildingHandle } from './buildings';
import type { ActiveWorld } from './city';

// --- Showcase tuning ------------------------------------------------------------
export const SHOWCASE_CONFIG = {
  /** Grid cell edge per archetype, tiles. */
  cellSize: 12,
  /** Columns in the review grid. */
  columns: 8,
  /** File count fed to every instance (mid-size buildings). */
  sampleFileCount: 18,
  /** Margin between the grid and the island edge, tiles. */
  margin: 12,
} as const;

/** True when the URL asks for the archetype review grid (?showcase=1). */
export function showcaseRequested(): boolean {
  return new URLSearchParams(window.location.search).get('showcase') === '1';
}

/**
 * One instance of every archetype on a flat island, sorted by category then
 * id, each with a sign naming it — the review deliverable for judging the
 * reservoir in one sitting. Normal camera controls apply.
 */
export function buildShowcase(): ActiveWorld {
  const c = SHOWCASE_CONFIG;
  const sorted = [...ARCHETYPES].sort(
    (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id),
  );
  const rows = Math.ceil(sorted.length / c.columns);
  const gridW = c.columns * c.cellSize;
  const gridD = rows * c.cellSize;
  const mapTiles = Math.max(gridW, gridD) + c.margin * 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);

  const terrain = buildTerrain({
    mapTiles,
    clearRect: { x0: 0, z0: 0, x1: mapTiles, z1: mapTiles }, // no trees in the grid
  });
  scene.add(terrain.group);

  const handles: BuildingHandle[] = [];
  const originX = (mapTiles - gridW) / 2;
  const originZ = (mapTiles - gridD) / 2;
  sorted.forEach((spec, i) => {
    const col = i % c.columns;
    const row = Math.floor(i / c.columns);
    const x = originX + col * c.cellSize + c.cellSize / 2;
    const z = originZ + row * c.cellSize + c.cellSize / 2;
    const building = buildArchetype(spec.id, {
      path: `showcase/${spec.id}`,
      fileCount: c.sampleFileCount,
    });
    building.group.position.set(x, 0, z);
    scene.add(building.group);
    handles.push(building);
    const sign = makeSign(spec.id, x + 2.2, z + 3.4);
    scene.add(sign.group);
    handles.push(sign);
  });

  const worldSize = mapTiles * TERRAIN_CONFIG.tileSize;
  return {
    scene,
    debugOverlay: null,
    bounds: { minX: 0, maxX: worldSize, minZ: 0, maxZ: worldSize },
    startTarget: new THREE.Vector3(worldSize / 2, 0, worldSize / 2),
    worldSize,
    update: () => {},
    dispose: () => {
      terrain.dispose();
      for (const h of handles) h.dispose();
    },
  };
}
