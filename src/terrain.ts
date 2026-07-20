import * as THREE from 'three';
import { PALETTE } from './palette';
import { TileKind } from './types';

// --- Terrain tuning --------------------------------------------------------
export const TERRAIN_CONFIG = {
  /** Demo map size in tiles (square); generated cities compute their own. */
  mapTiles: 80,
  /** World units per tile. */
  tileSize: 1,
  /** Texture pixels painted per tile on the ground canvas. */
  pixelsPerTile: 8,
  /** Water/shore/beach widths as fractions of the map edge, with minimums,
   * so coast proportions hold at any citySize instead of creeping inward. */
  waterFrac: 0.1125,
  waterColsMin: 6,
  shoreFrac: 0.025,
  shoreColsMin: 2,
  beachFrac: 0.0375,
  beachColsMin: 3,
  /** Chance an outskirt grass tile is dirt instead (0..1). */
  dirtChance: 0.12,
  /** Outskirt band (dirt + trees) starts beyond this fraction of half-size;
   * used when no explicit clear rect is provided (the Phase 1 demo map). */
  outskirtFrac: 0.65,
  /** Trees per tile^2 of map area (Phase 1's 220 trees on 80x80). */
  treeDensity: 0.034,
  /** Hard cap on scattered trees for very large maps. */
  treeCountMax: 2200,
  /** Trunk height / radius and canopy height / radius, world units. */
  trunkHeight: 0.5,
  trunkRadius: 0.09,
  canopyHeight: 1.3,
  canopyRadius: 0.55,
  /** PRNG seed so a given map is identical every load. */
  seed: 19950127,
} as const;

// --- Autoscaling -------------------------------------------------------------
export const CITY_SIZE_CONFIG = {
  /** citySize = base + k1*sqrt(fileCount) + k2*districtCount, tiles. */
  baseSize: 56,
  k1: 2.2,
  k2: 1.5,
  /** Smallest generated island. */
  minTiles: 72,
  /** Cap: extreme repos degrade gracefully instead of unrenderable maps. */
  maxTiles: 240,
} as const;

/** Island edge length (tiles) for an ingested codebase. */
export function computeCitySize(fileCount: number, districtCount: number): number {
  const c = CITY_SIZE_CONFIG;
  const raw = c.baseSize + c.k1 * Math.sqrt(fileCount) + c.k2 * districtCount;
  return Math.round(THREE.MathUtils.clamp(raw, c.minTiles, c.maxTiles));
}

/** Tile-rect kept clear of trees (the city footprint). */
export interface ClearRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** One interior pond: a safe bounding rect plus a silhouette style and jitter
 * seed. Water is rendered strictly INSIDE the rect (the rect boundary itself
 * carries the ring road), so graph/lot safety only ever sees the rectangle.
 * Structurally matches layout.ts's PondSpec fields — kept local so terrain
 * doesn't import from layout (layout already imports from terrain). */
export interface PondRect extends ClearRect {
  shape: 'rounded' | 'elongated' | 'round';
  seed: number;
}

export interface TerrainOptions {
  mapTiles: number;
  /** Trees/dirt never spawn inside this rect (generated city area). */
  clearRect?: ClearRect;
  /** Interior ponds: tiles inside render as water per each pond's silhouette.
   * Always well inside clearRect, so they never touch the tree/dirt pass. */
  ponds?: PondRect[];
  seed?: number;
}

export interface BuiltTerrain {
  group: THREE.Group;
  /** Ground material, exposed so the founding fade can tween opacity. */
  groundMaterial: THREE.MeshBasicMaterial;
  dispose: () => void;
}

/** Coast band widths for a given map size (tiles from the east edge). */
export function coastCols(mapTiles: number): { water: number; shore: number; beach: number } {
  const c = TERRAIN_CONFIG;
  return {
    water: Math.max(c.waterColsMin, Math.round(mapTiles * c.waterFrac)),
    shore: Math.max(c.shoreColsMin, Math.round(mapTiles * c.shoreFrac)),
    beach: Math.max(c.beachColsMin, Math.round(mapTiles * c.beachFrac)),
  };
}

/** Largest tile-x that is still land (west of the beach). */
export function landMaxX(mapTiles: number): number {
  const bands = coastCols(mapTiles);
  return mapTiles - bands.water - bands.shore - bands.beach - 1;
}

/** Deterministic PRNG (mulberry32) so scatter is stable across reloads. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → 0..1, for per-tile dirt placement independent of draw order. */
function tileHash(tx: number, tz: number, seed: number): number {
  let h = Math.imul(tx, 374761393) + Math.imul(tz, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Per-row (tz) tile offset applied to the east coastline: a smooth wander
 * plus a gentle diagonal slope plus tile-scale jag, so the coast reads as an
 * irregular silhouette instead of a straight edge. Clamped well inside the
 * land buffer layout.ts reserves east of its buildable footprint
 * (LAYOUT_CONFIG.eastGapFrac = 0.08 of mapTiles) so the wobble can never
 * touch the still-unperturbed cityRect that layout.ts computes from
 * landMaxX/coastCols below — this function only feeds the ground-texture
 * classifier, never landMaxX itself.
 */
function coastOffset(tz: number, mapTiles: number, seed: number): number {
  const t = tz / mapTiles;
  const phase = (seed % 997) * 0.011;
  const wander =
    Math.sin(t * Math.PI * 2.4 + phase) * mapTiles * 0.03 +
    Math.sin(t * Math.PI * 5.3 + phase * 1.6) * mapTiles * 0.012;
  const diagonal = (t - 0.5) * mapTiles * 0.05;
  const jag = (tileHash(0, tz, seed ^ 0x5bd1e995) - 0.5) * 3;
  const raw = wander + diagonal + jag;
  const eastGap = Math.max(4, Math.round(mapTiles * 0.08));
  const cap = Math.max(1, eastGap - 3);
  return THREE.MathUtils.clamp(raw, -cap, cap);
}

function inRect(tx: number, tz: number, r: ClearRect): boolean {
  return tx >= r.x0 && tx <= r.x1 && tz >= r.z0 && tz <= r.z1;
}

/**
 * Is this tile water for the given pond? Each silhouette style is a boundary
 * treatment inside the pond's safe bounding rect: tile coords are normalized
 * to [-1, 1] across the rect, a per-style distance field decides membership,
 * and the same category of per-cell jag Stage A uses on the coastline
 * (tileHash-driven) roughens the edge. Thresholds + jag amplitudes are chosen
 * so water never reaches the rect boundary (|u|,|v| = 1), which carries the
 * ring road.
 */
function pondWaterAt(tx: number, tz: number, p: PondRect): boolean {
  if (tx <= p.x0 || tx >= p.x1 || tz <= p.z0 || tz >= p.z1) return false;
  const hx = (p.x1 - p.x0) / 2;
  const hz = (p.z1 - p.z0) / 2;
  const u = (tx + 0.5 - (p.x0 + hx)) / hx;
  const v = (tz + 0.5 - (p.z0 + hz)) / hz;
  const jag = tileHash(tx, tz, p.seed) - 0.5;
  switch (p.shape) {
    case 'round':
      // Compact circle, minimal footprint, light edge roughness.
      return u * u + v * v < 0.62 + jag * 0.18;
    case 'elongated': {
      // River-like: the bounding rect is already long; a soft superellipse
      // with stronger jag along the banks reads as a channel segment.
      const d = Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3);
      return d < 0.55 + jag * 0.3;
    }
    default: {
      // Rounded rectangle (Stage B's silhouette), jitter applied evenly.
      const d = Math.pow(u, 4) + Math.pow(v, 4);
      return d < 0.58 + jag * 0.28;
    }
  }
}

/** Per-map tile classifier. Outskirts = outside the clear rect (or the demo
 * radius band when no rect is given). */
function makeTileKindAt(
  opts: Required<Pick<TerrainOptions, 'mapTiles' | 'seed'>> & {
    clearRect?: ClearRect;
    ponds?: PondRect[];
  },
): (tx: number, tz: number) => TileKind {
  const c = TERRAIN_CONFIG;
  const bands = coastCols(opts.mapTiles);
  const half = opts.mapTiles / 2;
  const demoRadius = half * c.outskirtFrac;
  const coastOffsets = new Float32Array(opts.mapTiles);
  for (let tz = 0; tz < opts.mapTiles; tz++) {
    coastOffsets[tz] = coastOffset(tz, opts.mapTiles, opts.seed);
  }
  const ponds = opts.ponds ?? [];
  return (tx, tz) => {
    const eastEdge = opts.mapTiles - tx + (coastOffsets[tz] ?? 0);
    if (eastEdge <= bands.water) return TileKind.Water;
    if (eastEdge <= bands.water + bands.shore) return TileKind.Shore;
    if (eastEdge <= bands.water + bands.shore + bands.beach) return TileKind.Beach;
    for (const p of ponds) {
      if (pondWaterAt(tx, tz, p)) return TileKind.Water;
      // One-tile shore dither ring around pond water, the coastline look.
      if (tx >= p.x0 - 1 && tx <= p.x1 + 1 && tz >= p.z0 - 1 && tz <= p.z1 + 1) {
        if (
          pondWaterAt(tx + 1, tz, p) ||
          pondWaterAt(tx - 1, tz, p) ||
          pondWaterAt(tx, tz + 1, p) ||
          pondWaterAt(tx, tz - 1, p)
        ) {
          return TileKind.Shore;
        }
      }
    }
    const isOutskirt = opts.clearRect
      ? !inRect(tx, tz, opts.clearRect)
      : Math.max(Math.abs(tx - half), Math.abs(tz - half)) > demoRadius;
    if (isOutskirt && tileHash(tx, tz, opts.seed) < c.dirtChance) return TileKind.Dirt;
    return TileKind.Grass;
  };
}

/** Paints the whole map into a canvas: bands, shore dither, grass grid. */
function buildGroundTexture(
  mapTiles: number,
  kindAt: (tx: number, tz: number) => TileKind,
): THREE.CanvasTexture {
  const px = TERRAIN_CONFIG.pixelsPerTile;
  const size = mapTiles * px;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  for (let tz = 0; tz < mapTiles; tz++) {
    for (let tx = 0; tx < mapTiles; tx++) {
      const kind = kindAt(tx, tz);
      const x0 = tx * px;
      const y0 = tz * px;
      switch (kind) {
        case TileKind.Water:
          ctx.fillStyle = PALETTE.water;
          ctx.fillRect(x0, y0, px, px);
          break;
        case TileKind.Shore: {
          // Bake a checker dither of shore-on-water, the era shoreline look.
          ctx.fillStyle = PALETTE.water;
          ctx.fillRect(x0, y0, px, px);
          ctx.fillStyle = PALETTE.shore;
          for (let y = 0; y < px; y += 2) {
            for (let x = 0; x < px; x += 2) {
              ctx.fillRect(x0 + x + (y % 4 === 0 ? 0 : 1), y0 + y, 1, 1);
              ctx.fillRect(x0 + x + (y % 4 === 0 ? 1 : 0), y0 + y + 1, 1, 1);
            }
          }
          break;
        }
        case TileKind.Beach:
          ctx.fillStyle = PALETTE.beach;
          ctx.fillRect(x0, y0, px, px);
          break;
        case TileKind.Dirt:
          ctx.fillStyle = PALETTE.dirt;
          ctx.fillRect(x0, y0, px, px);
          break;
        case TileKind.Grass:
          ctx.fillStyle = PALETTE.grass;
          ctx.fillRect(x0, y0, px, px);
          // Faint tile grid: one darker line along two tile edges.
          ctx.fillStyle = PALETTE.grassGrid;
          ctx.fillRect(x0, y0, px, 1);
          ctx.fillRect(x0, y0, 1, px);
          break;
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Cone canopies + cylinder trunks, instanced, with lit/shaded vertex colors. */
function buildTrees(
  mapTiles: number,
  seed: number,
  kindAt: (tx: number, tz: number) => TileKind,
  clearRect: ClearRect | undefined,
): { group: THREE.Group; dispose: () => void } {
  const c = TERRAIN_CONFIG;
  const rand = makeRandom(seed);
  const treeCount = Math.min(c.treeCountMax, Math.round(mapTiles * mapTiles * c.treeDensity));

  const positions: { x: number; z: number }[] = [];
  const half = mapTiles / 2;
  const demoRadius = half * c.outskirtFrac;
  let guard = 0;
  while (positions.length < treeCount && guard < treeCount * 50) {
    guard++;
    const tx = Math.floor(rand() * mapTiles);
    const tz = Math.floor(rand() * mapTiles);
    const kind = kindAt(tx, tz);
    if (kind !== TileKind.Grass && kind !== TileKind.Dirt) continue;
    const isOutskirt = clearRect
      ? !inRect(tx, tz, clearRect)
      : Math.max(Math.abs(tx - half), Math.abs(tz - half)) > demoRadius;
    if (!isOutskirt) continue;
    positions.push({
      x: (tx + 0.25 + rand() * 0.5) * c.tileSize,
      z: (tz + 0.25 + rand() * 0.5) * c.tileSize,
    });
  }

  // Canopy cone with baked two-tone vertex colors: +x/-z faces lit, rest shaded.
  const canopyGeo = new THREE.ConeGeometry(c.canopyRadius, c.canopyHeight, 6);
  const lit = new THREE.Color(PALETTE.canopy);
  const shade = new THREE.Color(PALETTE.canopyShade);
  const pos = canopyGeo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const sunFacing = pos.getX(i) - pos.getZ(i) > 0 ? lit : shade;
    colors[i * 3] = sunFacing.r;
    colors[i * 3 + 1] = sunFacing.g;
    colors[i * 3 + 2] = sunFacing.b;
  }
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const canopyMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const trunkGeo = new THREE.CylinderGeometry(c.trunkRadius, c.trunkRadius, c.trunkHeight, 5);
  const trunkMat = new THREE.MeshBasicMaterial({ color: PALETTE.trunk });

  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, positions.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const m = new THREE.Matrix4();
  positions.forEach((p, i) => {
    const scale = 0.8 + rand() * 0.5;
    m.makeScale(scale, scale, scale);
    m.setPosition(p.x, (c.trunkHeight + c.canopyHeight / 2) * scale, p.z);
    canopies.setMatrixAt(i, m);
    m.makeScale(scale, scale, scale);
    m.setPosition(p.x, (c.trunkHeight / 2) * scale, p.z);
    trunks.setMatrixAt(i, m);
  });

  const group = new THREE.Group();
  group.add(canopies, trunks);
  return {
    group,
    dispose: () => {
      canopyGeo.dispose();
      trunkGeo.dispose();
      canopyMat.dispose();
      trunkMat.dispose();
      canopies.dispose();
      trunks.dispose();
    },
  };
}

/** Builds a full terrain group: textured ground plane + outskirt trees. */
export function buildTerrain(options?: Partial<TerrainOptions>): BuiltTerrain {
  const c = TERRAIN_CONFIG;
  const mapTiles = options?.mapTiles ?? c.mapTiles;
  const seed = options?.seed ?? c.seed;
  const clearRect = options?.clearRect;
  const ponds = options?.ponds;
  const worldSize = mapTiles * c.tileSize;

  const kindAt = makeTileKindAt({ mapTiles, seed, clearRect, ponds });
  const groundTexture = buildGroundTexture(mapTiles, kindAt);
  const groundGeo = new THREE.PlaneGeometry(worldSize, worldSize);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMaterial = new THREE.MeshBasicMaterial({ map: groundTexture });
  const ground = new THREE.Mesh(groundGeo, groundMaterial);
  ground.position.set(worldSize / 2, 0, worldSize / 2);

  const trees = buildTrees(mapTiles, seed, kindAt, clearRect);

  const group = new THREE.Group();
  group.add(ground, trees.group);
  return {
    group,
    groundMaterial,
    dispose: () => {
      groundGeo.dispose();
      groundMaterial.dispose();
      groundTexture.dispose();
      trees.dispose();
    },
  };
}
