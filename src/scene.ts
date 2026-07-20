import * as THREE from 'three';
import { PALETTE } from './palette';
import { buildTerrain, TERRAIN_CONFIG } from './terrain';
import { buildRoads } from './roads';
import { buildTestBuildings } from './buildings';
import type { ActiveWorld } from './city';
import type { CityLayout, TileRect } from './layout';

/** The Phase 1 demo world: coastal island, test road grid, three archetypes.
 * Shown at boot until a scan or drop founds a real city. */
export function buildDemoWorld(): ActiveWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);

  const terrain = buildTerrain();
  const roads = buildRoads();
  const buildings = buildTestBuildings();
  scene.add(terrain.group, roads.group, buildings.group);

  const worldSize = TERRAIN_CONFIG.mapTiles * TERRAIN_CONFIG.tileSize;
  return {
    scene,
    debugOverlay: roads.debugOverlay,
    bounds: { minX: 0, maxX: worldSize, minZ: 0, maxZ: worldSize },
    startTarget: new THREE.Vector3(worldSize / 2, 0, worldSize / 2),
    worldSize,
    update: () => {},
    dispose: () => {
      terrain.dispose();
      roads.dispose();
      buildings.dispose();
    },
  };
}

/** Builder's Mode canvas: the same coastal island, empty — no roads, no
 * buildings, a clean buildable interior. Returns the world plus a minimal
 * layout whose buildable rect Edit Mode's placement rules can reason about
 * (degenerate plaza far off-map so nothing is blocked by it). */
export function buildBuilderWorld(): { world: ActiveWorld; layout: CityLayout } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);

  const mapTiles = TERRAIN_CONFIG.mapTiles;
  const cityRect: TileRect = { x0: 10, z0: 10, x1: 60, z1: 70 };
  const terrain = buildTerrain({ mapTiles, clearRect: cityRect });
  scene.add(terrain.group);

  const worldSize = mapTiles * TERRAIN_CONFIG.tileSize;
  const offMap: TileRect = { x0: -99, z0: -99, x1: -98, z1: -98 };
  const layout: CityLayout = {
    mapTiles,
    cityRect,
    plaza: offMap,
    ponds: [],
    bridges: [],
    segments: [],
    lots: [],
    stats: {
      fileCount: 0,
      dirCount: 0,
      districtCount: 0,
      totalSize: 0,
      buildingsShown: 0,
      buildingsMerged: 0,
      densityFloor: 0,
      amenitiesRequested: 0,
      truncated: false,
    },
    debugLines: [],
  };
  const world: ActiveWorld = {
    scene,
    debugOverlay: null,
    bounds: { minX: 0, maxX: worldSize, minZ: 0, maxZ: worldSize },
    startTarget: new THREE.Vector3(worldSize / 2, 0, worldSize / 2),
    worldSize,
    update: () => {},
    dispose: () => {
      terrain.dispose();
    },
  };
  return { world, layout };
}
