import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { CitySource, FileRecord } from './types';
import type { RoadSegmentSpec } from './roads';
import { computeCitySize, landMaxX } from './terrain';
import {
  matchCandidates,
  matchRootFile,
  instanceFootprint,
  hashPath,
  AMENITY_SET,
  AMENITY_SIGNS,
} from './archetypes';

// --- Layout tuning ------------------------------------------------------------
export const LAYOUT_CONFIG = {
  /** Honest cap: at most this many buildings; deep dirs merge upward. */
  maxBuildings: 400,
  /** City margin from the map's west/north/south edges, fraction of mapTiles. */
  marginFrac: 0.14,
  /** Gap between the city's east edge and the beach, fraction of mapTiles. */
  eastGapFrac: 0.08,
  /** Plaza edge, fraction of mapTiles, clamped. */
  plazaFrac: 0.12,
  plazaMin: 8,
  plazaMax: 14,
  /** Ring inset from a cell boundary to a lot's near edge (road half + gap). */
  lotInset: 1.7,
  /** Gap between neighboring lots along a ring edge. */
  lotGap: 0.9,
  /** Largest building footprint the ring band allows. */
  maxLotFootprint: 7.5,
  /** Cells thinner than this (tiles) don't get their own roads or lots. */
  minCellSide: 6,
  /** Trace roads around depth-2 cells only when at least this wide (tiles). */
  minSubCellSide: 6,
  /** Small-town mode: repos at or under these totals also give each FILE its
   * own small lot (house by extension, sign = filename), so flat little
   * repos read as hamlets instead of a lone tower next to city hall.
   * Still honest: every extra building is a real file. */
  smallTownMaxFiles: 48,
  smallTownMaxDirs: 5,
  /** Civic amenities (diner, cathedral, parks…): pure skyline diversity.
   * DENSITY FLOOR: the town should never look empty relative to its own
   * island. Target building count = mapTiles * densityFloorPerTile; when
   * real directories fall short, amenities make up the difference (capped).
   * The HUD population is NEVER touched by this — it always shows the true
   * file count; only decoration density is floored. */
  /** Buildings per tile^2 — calibrated so the floor lands at ~35 buildings
   * for the 91-tile example city and ~260 for a 240-tile metropolis, the two
   * reference baselines. */
  densityFloorPerTileSq: 0.0045,
  /** Even the tiniest island gets a proper small town's worth of decoration. */
  densityFloorMin: 34,
  amenityBase: 2,
  amenityMax: 120,
  /** Interior ponds (Stage B/C): only cities at or above this mapTiles get
   * any — below this, cityRect is too cramped for a pond plus its road
   * clearance without dominating the map (see Natural-Taste at the 72-tile
   * floor, which stays pond-free). */
  lakeMinMapTiles: 85,
  /** Pond base edge, fraction of mapTiles, clamped — relative to the city. */
  lakeFrac: 0.09,
  lakeMin: 8,
  lakeMax: 16,
  /** Ponds above this mapTiles may number 2; above the second, 3. */
  pondTwoMapTiles: 110,
  pondThreeMapTiles: 150,
  /** Candidate placements tried per pond before degrading to fewer ponds. */
  pondPlaceTries: 8,
  /** A pond rect must clear the cityRect edges by this many tiles on every
   * side, so its boulevard connectors (cityRect edge → pond ring) never
   * degenerate to a zero-length segment that would leave the ring
   * disconnected. */
  lakeEdgeMargin: 8,
  /** Minimum gap (tiles) required between a pond rect and the plaza rect —
   * and between pond rects — below this the pond is skipped rather than risk
   * overlapping holes. */
  lakeGapFromPlaza: 6,
  /** Bridges are the exception path: a road may cross a pond only when the
   * ring-road detour would add at least this many tiles versus going
   * straight across (2 × distance from the crossing line to the nearest
   * ring edge). At 14, plain ponds (≤16 wide, max excess 16) almost never
   * qualify; elongated river-like ponds crossed near their middle do. */
  bridgeMinDetour: 14,
  /** No bridge longer than this many tiles; anything wider stays route-around. */
  bridgeMaxSpan: 20,
} as const;

export interface TileRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Pond silhouette styles. Every style is a boundary treatment rendered
 * INSIDE the pond's safe bounding rect (terrain.ts), so roads, lots, and the
 * graph only ever reason about the rectangle. */
export type PondShape = 'rounded' | 'elongated' | 'round';

export interface PondSpec {
  /** Safe bounding rect: ring road runs on its boundary, water stays inside. */
  rect: TileRect;
  shape: PondShape;
  /** Per-pond jitter seed for the organic edge (terrain.ts). */
  seed: number;
}

/** One road span allowed to cross a pond on a bridge deck instead of being
 * clipped to the ring. Span [a, b] along `axis` at cross-position `c` is the
 * pond rect's extent, so the deck's ends land on the ring-road banks. */
export interface BridgeSpec {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
}

export interface LotSpec {
  /** Directory (or root file) path this building represents. */
  path: string;
  /** Sign text (basename, possibly with "+n more"). */
  signText: string;
  archetypeId: string;
  /** Direct file count (drives height); merged children add to mergedCount. */
  fileCount: number;
  totalSize: number;
  /** How many deeper directories merged into this lot ("+n more"). */
  mergedCount: number;
  /** Building center, world units. */
  x: number;
  z: number;
  /** Yaw so the door face points at the adjacent road. */
  rotationY: number;
  footprint: number;
  /** Door tile position (on the lot's road-facing edge). */
  doorX: number;
  doorZ: number;
  /** Depth-1 district this lot belongs to (root lots use "plaza"). */
  district: string;
  /** Ordered alternates from matchCandidates; feeds the diversify pass. */
  candidates: string[];
}

export interface CityStats {
  /** True totals, always shown regardless of what's drawn (HONESTY RULE). */
  fileCount: number;
  dirCount: number;
  districtCount: number;
  totalSize: number;
  buildingsShown: number;
  buildingsMerged: number;
  /** Density floor for this island size (decoration target, never population). */
  densityFloor: number;
  /** How many amenity lots were requested to reach the floor. */
  amenitiesRequested: number;
  truncated: boolean;
}

export interface CityLayout {
  mapTiles: number;
  cityRect: TileRect;
  plaza: TileRect;
  /** Interior ponds, when the city is large enough to earn any (0–3). */
  ponds: PondSpec[];
  /** Road spans that cross a pond on a bridge deck (usually empty). */
  bridges: BridgeSpec[];
  segments: RoadSegmentSpec[];
  lots: LotSpec[];
  stats: CityStats;
  /** Per-directory placement trace: what got a lot, what merged and where. */
  debugLines: string[];
}

// --- Directory tree --------------------------------------------------------------

interface DirNode {
  name: string;
  path: string;
  depth: number;
  files: FileRecord[];
  children: DirNode[];
  childIndex: Map<string, DirNode>;
  totalSize: number;
}

function newDir(name: string, path: string, depth: number): DirNode {
  return { name, path, depth, files: [], children: [], childIndex: new Map(), totalSize: 0 };
}

function buildTree(files: FileRecord[]): DirNode {
  const root = newDir('', '', 0);
  for (const f of files) {
    const segments = f.path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (seg === undefined || seg === '') continue;
      let child = node.childIndex.get(seg);
      if (!child) {
        child = newDir(seg, node.path === '' ? seg : `${node.path}/${seg}`, node.depth + 1);
        node.childIndex.set(seg, child);
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(f);
  }
  const sumSizes = (n: DirNode): number => {
    n.totalSize =
      n.files.reduce((s, f) => s + f.size, 0) + n.children.reduce((s, c) => s + sumSizes(c), 0);
    return n.totalSize;
  };
  sumSizes(root);
  return root;
}

function countDirs(root: DirNode): number {
  let count = 0;
  const walk = (n: DirNode): void => {
    for (const c of n.children) {
      count++;
      walk(c);
    }
  };
  walk(root);
  return count;
}

function dominantExt(files: FileRecord[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = f.path.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) continue;
    const ext = base.slice(dot + 1).toLowerCase();
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [ext, n] of counts) {
    if (n > bestCount) {
      best = ext;
      bestCount = n;
    }
  }
  return best;
}

// --- Layout ------------------------------------------------------------------------

/** One future building: a directory, a small-town file, or an amenity. */
interface Resident {
  path: string;
  name: string;
  depth: number;
  fileCount: number;
  totalSize: number;
  dominantExt: string;
  /** Amenities bypass matching: exactly this archetype, generic sign. */
  forcedArchetype?: string;
}

function dirResident(d: DirNode): Resident {
  return {
    path: d.path,
    name: d.name,
    depth: d.depth,
    fileCount: d.files.length,
    totalSize: d.totalSize,
    dominantExt: dominantExt(d.files),
  };
}

function fileResident(f: FileRecord, depth: number): Resident {
  const name = f.path.split('/').pop() ?? f.path;
  const dot = name.lastIndexOf('.');
  return {
    path: f.path,
    name,
    depth,
    fileCount: 1,
    totalSize: f.size,
    dominantExt: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
  };
}

interface CellInfo {
  rect: TileRect;
  /** Directories (or small-town files) whose buildings live on this ring. */
  residents: Resident[];
}

/** Full city plan from an ingested source. Deterministic for a given source. */
export function generateLayout(source: CitySource): CityLayout {
  const c = LAYOUT_CONFIG;
  const root = buildTree(source.files);
  const dirCount = countDirs(root);
  const fileCount = source.files.length;
  const mapTiles = computeCitySize(fileCount, dirCount);

  // City footprint on land.
  const margin = Math.round(mapTiles * c.marginFrac);
  const eastGap = Math.round(mapTiles * c.eastGapFrac);
  const cityRect: TileRect = {
    x0: margin,
    z0: margin,
    x1: landMaxX(mapTiles) - eastGap,
    z1: mapTiles - margin,
  };

  // Central plaza.
  const plazaSize = Math.round(
    Math.min(c.plazaMax, Math.max(c.plazaMin, mapTiles * c.plazaFrac)),
  );
  const pcx = Math.round((cityRect.x0 + cityRect.x1) / 2);
  const pcz = Math.round((cityRect.z0 + cityRect.z1) / 2);
  const plaza: TileRect = {
    x0: pcx - Math.floor(plazaSize / 2),
    z0: pcz - Math.floor(plazaSize / 2),
    x1: pcx + Math.ceil(plazaSize / 2),
    z1: pcz + Math.ceil(plazaSize / 2),
  };

  // Interior ponds: rectangular holes like the plaza, but with count, size,
  // position, and silhouette style drawn from a deterministic per-repo hash
  // (same pattern as archetype variants and vehicle color jitter — unique per
  // repo, identical on rescan). Placement is validated analytically against
  // the plaza, other ponds, and the cityRect margins; a candidate that can't
  // be placed safely is skipped, degrading toward fewer ponds. Zero ponds is
  // a correct outcome, not a failure.
  const ponds: PondSpec[] = generatePonds(source.displayName, mapTiles, cityRect, plaza);

  // Squarified treemap over the district hierarchy (value = file count).
  const h = hierarchy<DirNode>(root, (d) => d.children).sum((d) => Math.max(1, d.files.length));
  treemap<DirNode>()
    .tile(treemapSquarify)
    .size([cityRect.x1 - cityRect.x0, cityRect.z1 - cityRect.z0])
    .round(true)(h);

  // Snapped cell rects for depth-1 and depth-2 directories.
  const cellFor = new Map<string, CellInfo>();
  const rectOf = (n: d3.HierarchyRectangularNode<DirNode>): TileRect => ({
    x0: cityRect.x0 + Math.round(n.x0),
    z0: cityRect.z0 + Math.round(n.y0),
    x1: cityRect.x0 + Math.round(n.x1),
    z1: cityRect.z0 + Math.round(n.y1),
  });
  const usable = (r: TileRect): boolean =>
    r.x1 - r.x0 >= c.minCellSide && r.z1 - r.z0 >= c.minCellSide;

  const hr = h as d3.HierarchyRectangularNode<DirNode>;
  for (const d1 of hr.children ?? []) {
    const r1 = rectOf(d1);
    if (usable(r1)) cellFor.set(d1.data.path, { rect: r1, residents: [] });
    for (const d2 of d1.children ?? []) {
      const r2 = rectOf(d2);
      if (
        cellFor.has(d1.data.path) &&
        r2.x1 - r2.x0 >= c.minSubCellSide &&
        r2.z1 - r2.z0 >= c.minSubCellSide
      ) {
        cellFor.set(d2.data.path, { rect: r2, residents: [] });
      }
    }
  }

  // Road segments: city perimeter + every usable cell's boundary, clipped
  // around every "hole" (plaza, and the interior lake if this city earned
  // one) — then each hole's own perimeter ring. roads.ts dedupes.
  const segments: RoadSegmentSpec[] = [];
  const addRect = (r: TileRect): void => {
    segments.push({ axis: 'x', c: r.z0, a: r.x0, b: r.x1 });
    segments.push({ axis: 'x', c: r.z1, a: r.x0, b: r.x1 });
    segments.push({ axis: 'z', c: r.x0, a: r.z0, b: r.z1 });
    segments.push({ axis: 'z', c: r.x1, a: r.z0, b: r.z1 });
  };
  addRect(cityRect);
  for (const cell of cellFor.values()) addRect(cell.rect);

  const holes: TileRect[] = [plaza, ...ponds.map((p) => p.rect)];
  // Hole-clipping with a bridge exception. Route-around is the default (Stage
  // B's finding: it works cleanly almost everywhere). For ponds only — never
  // the plaza — the single best segment that fully spans the pond may keep
  // its crossing as a bridge, when the ring detour is clearly worse: detour
  // excess (2 × distance from the crossing line to the nearest ring edge) of
  // at least bridgeMinDetour tiles, and a crossing no longer than
  // bridgeMaxSpan. At most one bridge per pond keeps it the exception path.
  const bridges: BridgeSpec[] = [];
  const clipAgainstHoles = (specs: RoadSegmentSpec[]): RoadSegmentSpec[] => {
    let current = specs;
    holes.forEach((hole, holeIdx) => {
      const isPond = holeIdx > 0;
      let bridge: { seg: RoadSegmentSpec; excess: number } | null = null;
      if (isPond) {
        for (const seg of current) {
          const inBand =
            seg.axis === 'x'
              ? seg.c > hole.z0 && seg.c < hole.z1
              : seg.c > hole.x0 && seg.c < hole.x1;
          const lo = seg.axis === 'x' ? hole.x0 : hole.z0;
          const hi = seg.axis === 'x' ? hole.x1 : hole.z1;
          const bandLo = seg.axis === 'x' ? hole.z0 : hole.x0;
          const bandHi = seg.axis === 'x' ? hole.z1 : hole.x1;
          // Only full crossings qualify: both ends on solid ground.
          if (!inBand || seg.a >= lo || seg.b <= hi) continue;
          if (hi - lo > c.bridgeMaxSpan) continue;
          const excess = 2 * Math.min(seg.c - bandLo, bandHi - seg.c);
          if (excess < c.bridgeMinDetour) continue;
          if (!bridge || excess > bridge.excess) bridge = { seg, excess };
        }
        if (bridge) {
          const lo = bridge.seg.axis === 'x' ? hole.x0 : hole.z0;
          const hi = bridge.seg.axis === 'x' ? hole.x1 : hole.z1;
          bridges.push({ axis: bridge.seg.axis, c: bridge.seg.c, a: lo, b: hi });
        }
      }
      const next: RoadSegmentSpec[] = [];
      for (const seg of current) {
        if (bridge && seg === bridge.seg) {
          next.push(seg); // crosses the pond on a bridge deck
          continue;
        }
        const inBand =
          seg.axis === 'x'
            ? seg.c > hole.z0 && seg.c < hole.z1
            : seg.c > hole.x0 && seg.c < hole.x1;
        const lo = seg.axis === 'x' ? hole.x0 : hole.z0;
        const hi = seg.axis === 'x' ? hole.x1 : hole.z1;
        if (!inBand || seg.b <= lo || seg.a >= hi) {
          next.push(seg);
          continue;
        }
        if (seg.a < lo) next.push({ axis: seg.axis, c: seg.c, a: seg.a, b: lo });
        if (seg.b > hi) next.push({ axis: seg.axis, c: seg.c, a: hi, b: seg.b });
      }
      current = next;
    });
    return current;
  };
  // Boulevards from each hole out to the city edge on both axes — without
  // these a hole's ring can be an isolated component when no treemap
  // boundary happens to cross it. Also run through the same hole-clipping
  // pass, so the lake's boulevards detour around the plaza (or vice versa)
  // instead of cutting straight through it.
  const boulevardsFor = (hole: TileRect): RoadSegmentSpec[] => {
    const hcx = (hole.x0 + hole.x1) / 2;
    const hcz = (hole.z0 + hole.z1) / 2;
    return [
      { axis: 'x', c: hcz, a: cityRect.x0, b: hole.x0 },
      { axis: 'x', c: hcz, a: hole.x1, b: cityRect.x1 },
      { axis: 'z', c: hcx, a: cityRect.z0, b: hole.z0 },
      { axis: 'z', c: hcx, a: hole.z1, b: cityRect.z1 },
    ];
  };
  const ringOf = (hole: TileRect): RoadSegmentSpec[] => [
    { axis: 'x', c: hole.z0, a: hole.x0, b: hole.x1 },
    { axis: 'x', c: hole.z1, a: hole.x0, b: hole.x1 },
    { axis: 'z', c: hole.x0, a: hole.z0, b: hole.z1 },
    { axis: 'z', c: hole.x1, a: hole.z0, b: hole.z1 },
  ];
  const rawNonRing = segments.concat(holes.flatMap(boulevardsFor));
  const finalSegments = clipAgainstHoles(rawNonRing).concat(holes.flatMap(ringOf));

  // Assign every directory to the nearest ancestor cell. The whole city rect
  // acts as the root cell, so directories whose treemap slice was too small
  // for its own cell still get a lot on the city's perimeter ring instead of
  // silently vanishing into city hall (the Phase 2A small-repo bug).
  const rootCell: CellInfo = { rect: cityRect, residents: [] };
  const cellOfDir = new Map<string, CellInfo>();
  const assign = (n: DirNode, ancestorCell: CellInfo): void => {
    for (const child of n.children) {
      const cell = cellFor.get(child.path) ?? ancestorCell;
      cell.residents.push(dirResident(child));
      cellOfDir.set(child.path, cell);
      assign(child, cell);
    }
  };
  assign(root, rootCell);
  const allCells = [...cellFor.values(), rootCell];

  // Small-town mode: flat little repos also give each file its own lot.
  const smallTown = fileCount <= c.smallTownMaxFiles && dirCount <= c.smallTownMaxDirs;
  if (smallTown) {
    const addFiles = (n: DirNode): void => {
      const cell = cellOfDir.get(n.path) ?? rootCell;
      for (const f of n.files) {
        // Root landmark files (README, LICENSE, …) already get plaza lots.
        if (n.depth === 0 && matchRootFile(f.path) !== null) continue;
        cell.residents.push(fileResident(f, n.depth + 1));
      }
      for (const child of n.children) addFiles(child);
    };
    addFiles(root);
  }

  // Civic amenities: pure-diversity buildings that fill the gap between the
  // real directory count and the island's density floor. Types rotate
  // deterministically from the repo-name hash; they're dealt round-robin
  // across every cell ring (not just the perimeter) so the whole map reads
  // fleshed out. fileCount 0 sorts them last per ring, so real lots always
  // take space first.
  let realResidents = 0;
  for (const cell of allCells) realResidents += cell.residents.length;
  const densityFloor = Math.max(
    c.densityFloorMin,
    Math.round(mapTiles * mapTiles * c.densityFloorPerTileSq),
  );
  const amenityCount = Math.min(
    c.amenityMax,
    Math.max(c.amenityBase, densityFloor - realResidents),
  );
  const amenityHash = hashPath(source.displayName);
  for (let i = 0; i < amenityCount; i++) {
    const id = AMENITY_SET[(amenityHash + i) % AMENITY_SET.length];
    const cell = allCells[i % allCells.length];
    if (id === undefined || cell === undefined) continue;
    cell.residents.push({
      path: `amenity/${id}-${i}`,
      name: AMENITY_SIGNS[id] ?? id,
      depth: 1,
      fileCount: 0,
      totalSize: 0,
      dominantExt: '',
      forcedArchetype: id,
    });
  }

  // Honest cap: merge the deepest directories upward until under budget.
  let shown = 0;
  for (const cell of allCells) shown += cell.residents.length;
  const mergedInto = new Map<string, number>();
  if (shown > c.maxBuildings) {
    const all: Resident[] = [];
    for (const cell of allCells) all.push(...cell.residents);
    all.sort((a, b) => b.depth - a.depth || a.fileCount - b.fileCount);
    const dropped = new Set<string>();
    for (const dir of all) {
      if (shown <= c.maxBuildings) break;
      dropped.add(dir.path);
      const parentPath = dir.path.includes('/')
        ? dir.path.slice(0, dir.path.lastIndexOf('/'))
        : '';
      mergedInto.set(parentPath, (mergedInto.get(parentPath) ?? 0) + 1);
      shown--;
    }
    for (const cell of allCells) {
      cell.residents = cell.residents.filter((d) => !dropped.has(d.path));
    }
  }

  // Place lots on cell rings (root cell = the city perimeter ring), keeping
  // clear of every hole (plaza, lake) and of every road a lot doesn't itself
  // face.
  const lots: LotSpec[] = [];
  const debugLines: string[] = [];
  if (ponds.length === 0) {
    debugLines.push(
      `ponds: none (mapTiles ${mapTiles} < ${c.lakeMinMapTiles}, or no safe placement)`,
    );
  }
  for (const p of ponds) {
    debugLines.push(
      `pond: ${p.shape} ${p.rect.x1 - p.rect.x0}x${p.rect.z1 - p.rect.z0} tiles at (${p.rect.x0},${p.rect.z0})`,
    );
  }
  for (const b of bridges) {
    debugLines.push(`bridge: ${b.axis}-axis at ${b.c}, span ${b.a}..${b.b}`);
  }
  const districtOf = (path: string): string => path.split('/')[0] ?? path;
  const blocked = (x: number, z: number, f: number): boolean => {
    const pad = f / 2 + 1.2;
    for (const hole of holes) {
      if (x > hole.x0 - pad && x < hole.x1 + pad && z > hole.z0 - pad && z < hole.z1 + pad) {
        return true; // inside a hole (+margin)
      }
    }
    // Any road strip: lot rect vs road band (half-width 1 + 0.3 gap). A lot's
    // own facing road sits at inset (1.7) + f/2 from its center, which clears
    // this test by construction; everything closer is a genuine collision.
    const half = f / 2 + 1.3;
    for (const seg of finalSegments) {
      const along = seg.axis === 'x' ? x : z;
      const cross = seg.axis === 'x' ? z : x;
      if (
        Math.abs(cross - seg.c) < half &&
        along > seg.a - 0.3 - f / 2 &&
        along < seg.b + 0.3 + f / 2
      ) {
        return true;
      }
    }
    return false;
  };
  let mergedTotal = 0;
  for (const cell of allCells) {
    mergedTotal += placeRing(cell, lots, mergedInto, districtOf, blocked, debugLines);
  }
  diversify(lots, debugLines);

  // Plaza: city hall + root-file landmarks (+ any orphaned dirs merged in).
  const plazaCX = (plaza.x0 + plaza.x1) / 2;
  const plazaCZ = (plaza.z0 + plaza.z1) / 2;
  const rootMerged = mergedInto.get('') ?? 0;
  lots.push({
    path: '',
    signText: source.displayName + (rootMerged > 0 ? ` +${rootMerged} more` : ''),
    archetypeId: 'city-hall',
    fileCount: root.files.length,
    totalSize: root.totalSize,
    mergedCount: rootMerged,
    x: plazaCX,
    z: plazaCZ,
    rotationY: 0,
    footprint: instanceFootprint('city-hall', {
      path: source.displayName,
      fileCount: fileCount,
    }),
    doorX: plazaCX,
    doorZ: plaza.z0,
    district: 'plaza',
    candidates: ['city-hall'],
  });
  // Landmarks along the plaza's inner south edge, spaced evenly.
  const landmarks: [string, FileRecord][] = [];
  for (const f of root.files) {
    const id = matchRootFile(f.path);
    if (id) landmarks.push([id, f]);
  }
  landmarks.slice(0, 6).forEach(([id, f], i) => {
    const t = (i + 1) / (Math.min(landmarks.length, 6) + 1);
    const lx = plaza.x0 + t * (plaza.x1 - plaza.x0);
    const lz = plaza.z1 - LAYOUT_CONFIG.lotInset - 0.8;
    lots.push({
      path: f.path,
      signText: f.path,
      archetypeId: id,
      fileCount: 1,
      totalSize: f.size,
      mergedCount: 0,
      x: lx,
      z: lz,
      rotationY: Math.PI, // face the plaza's south road
      footprint: instanceFootprint(id, { path: f.path, fileCount: 1 }),
      doorX: lx,
      doorZ: plaza.z1,
      district: 'plaza',
      candidates: [id],
    });
  });

  return {
    mapTiles,
    cityRect,
    plaza,
    ponds,
    bridges,
    segments: finalSegments,
    lots,
    stats: {
      fileCount,
      dirCount,
      districtCount: root.children.length,
      totalSize: root.totalSize,
      buildingsShown: lots.length,
      buildingsMerged:
        mergedTotal +
        (mergedInto.size > 0 ? [...mergedInto.values()].reduce((a, b) => a + b, 0) : 0),
      densityFloor,
      amenitiesRequested: amenityCount,
      truncated: source.truncated,
    },
    debugLines,
  };
}

/** Deterministic PRNG (mulberry32) — pond layout must be identical on rescan. */
function makePondRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pond plan for one city: count (1–3, gated and scaled by map size), sizes,
 * positions, and silhouette styles, all drawn from the repo-name hash so the
 * result is unique per repo but reproducible on rescan. Every candidate is
 * validated against the plaza, previously placed ponds, and the cityRect
 * margins; failures retry a few times, then the pond is skipped (degrade
 * toward fewer/none rather than force a bad placement).
 */
function generatePonds(
  displayName: string,
  mapTiles: number,
  cityRect: TileRect,
  plaza: TileRect,
): PondSpec[] {
  const c = LAYOUT_CONFIG;
  if (mapTiles < c.lakeMinMapTiles) return [];
  const rand = makePondRandom(hashPath(displayName) ^ Math.imul(mapTiles, 2654435761));
  const maxCount = mapTiles >= c.pondThreeMapTiles ? 3 : mapTiles >= c.pondTwoMapTiles ? 2 : 1;
  const count = 1 + Math.floor(rand() * maxCount);

  const base = Math.round(Math.min(c.lakeMax, Math.max(c.lakeMin, mapTiles * c.lakeFrac)));
  const styles: PondShape[] = ['rounded', 'elongated', 'round'];
  // Distinct styles for up to three ponds: random start, random step coprime
  // to the style count.
  const styleStart = Math.floor(rand() * styles.length);
  const styleStep = rand() < 0.5 ? 1 : 2;

  const ponds: PondSpec[] = [];
  const gap = c.lakeGapFromPlaza;
  const clearOf = (a: TileRect, b: TileRect): boolean =>
    a.x1 + gap <= b.x0 || a.x0 - gap >= b.x1 || a.z1 + gap <= b.z0 || a.z0 - gap >= b.z1;

  for (let i = 0; i < count; i++) {
    const shape = styles[(styleStart + i * styleStep) % styles.length] ?? 'rounded';
    // Footprint per silhouette: the safe bounding rect each style fills.
    const stretch = 0.85 + rand() * 0.3;
    let w: number;
    let h: number;
    switch (shape) {
      case 'elongated': {
        const long = Math.round(base * 1.9 * stretch);
        const short = Math.max(6, Math.round(base * 0.55));
        if (rand() < 0.5) {
          w = long;
          h = short;
        } else {
          w = short;
          h = long;
        }
        break;
      }
      case 'round':
        w = h = Math.max(6, Math.round(base * 0.7 * stretch));
        break;
      default:
        w = Math.round(base * stretch);
        h = Math.round(base * (0.85 + rand() * 0.3));
    }

    const m = c.lakeEdgeMargin;
    const xLo = cityRect.x0 + m;
    const xHi = cityRect.x1 - m - w;
    const zLo = cityRect.z0 + m;
    const zHi = cityRect.z1 - m - h;
    if (xHi < xLo || zHi < zLo) continue; // this pond can't fit; degrade

    for (let attempt = 0; attempt < c.pondPlaceTries; attempt++) {
      const x0 = Math.round(xLo + rand() * (xHi - xLo));
      const z0 = Math.round(zLo + rand() * (zHi - zLo));
      const candidate: TileRect = { x0, z0, x1: x0 + w, z1: z0 + h };
      if (!clearOf(candidate, plaza)) continue;
      if (!ponds.every((p) => clearOf(candidate, p.rect))) continue;
      ponds.push({ rect: candidate, shape, seed: Math.floor(rand() * 0x7fffffff) });
      break;
    }
  }
  return ponds;
}

/**
 * Greedy ring placement: walk the cell's four inner edges, placing each
 * resident's lot along the ring; residents that don't fit merge into the
 * cell's first lot ("+n more"). Returns how many merged.
 */
function placeRing(
  cell: CellInfo,
  lots: LotSpec[],
  mergedInto: Map<string, number>,
  districtOf: (path: string) => string,
  blocked: (x: number, z: number, footprint: number) => boolean,
  debugLines: string[],
): number {
  const c = LAYOUT_CONFIG;
  const r = cell.rect;
  const inset = c.lotInset;
  // Buildings can't be deeper than the cell allows: keep the far side clear
  // of the opposite edge's road (small treemap cells get small buildings).
  const cellCap = Math.max(1.4, Math.min(r.x1 - r.x0, r.z1 - r.z0) - 2 * inset - 1.2);
  // Edge walks: [startX, startZ, dirX, dirZ, run, rotationY, doorAxis]
  const edges: [number, number, number, number, number, number][] = [
    [r.x0 + inset, r.z0 + inset, 1, 0, r.x1 - r.x0 - 2 * inset, 0], // north edge, faces -z road
    [r.x1 - inset, r.z0 + inset, 0, 1, r.z1 - r.z0 - 2 * inset, -Math.PI / 2], // east edge, faces +x road
    [r.x1 - inset, r.z1 - inset, -1, 0, r.x1 - r.x0 - 2 * inset, Math.PI], // south edge
    [r.x0 + inset, r.z1 - inset, 0, -1, r.z1 - r.z0 - 2 * inset, Math.PI / 2], // west edge
  ];
  // Sort largest first so big residents take the long edges.
  const residents = [...cell.residents].sort((a, b) => b.fileCount - a.fileCount);
  let edgeIdx = 0;
  let used = 0;
  let merged = 0;
  let firstLot: LotSpec | null = null;

  for (const dir of residents) {
    const candidates = dir.forcedArchetype
      ? [dir.forcedArchetype]
      : matchCandidates({
          name: dir.name,
          path: dir.path,
          isRoot: false,
          fileCount: dir.fileCount,
          dominantExt: dir.dominantExt,
        });
    const archetypeId = candidates[0] ?? 'house-generic';
    const footprint = instanceFootprint(archetypeId, {
      path: dir.path,
      fileCount: dir.fileCount,
      maxFootprint: Math.min(c.maxLotFootprint, cellCap),
    });
    const need = footprint + c.lotGap;
    // Scan the ring for the next spot with room that isn't blocked by the
    // plaza or another road; step past obstructions a tile at a time. If this
    // resident finds nothing, restore the scan position so one oversized
    // failure doesn't exhaust the ring for every smaller resident after it.
    const scanEdge = edgeIdx;
    const scanUsed = used;
    let spot: { bx: number; bz: number; x: number; z: number; rotY: number } | null = null;
    while (edgeIdx < edges.length && !spot) {
      const edge = edges[edgeIdx];
      if (!edge || used + need > edge[4]) {
        edgeIdx++;
        used = 0;
        continue;
      }
      const [sx, sz, dx, dz, , rotY] = edge;
      const along = used + need / 2;
      const bx = sx + dx * along;
      const bz = sz + dz * along;
      // Set the lot back so its road-facing edge sits at the inset line
      // (0.7 of sidewalk beyond the asphalt), never inside the road.
      const inwardX = dz !== 0 ? (edgeIdx === 1 ? -1 : 1) : 0;
      const inwardZ = dx !== 0 ? (edgeIdx === 0 ? 1 : -1) : 0;
      const depthPad = footprint / 2;
      const x = bx + inwardX * depthPad;
      const z = bz + inwardZ * depthPad;
      if (blocked(x, z, footprint)) {
        used += 1; // step past the obstruction and rescan
        continue;
      }
      spot = { bx, bz, x, z, rotY };
      used += need;
    }
    if (!spot) {
      edgeIdx = scanEdge;
      used = scanUsed;
      if (dir.forcedArchetype) {
        // Amenities are decoration: if there's no room, they simply don't exist.
        debugLines.push(`amenity skipped (ring full): ${dir.path}`);
        continue;
      }
      // Ring full: merge into the cell's first lot.
      merged++;
      if (firstLot) {
        firstLot.mergedCount++;
        firstLot.signText = `${firstLot.signText.split(' +')[0]} +${firstLot.mergedCount} more`;
      }
      debugLines.push(
        `merged: ${dir.path} (${dir.fileCount} files) → ${firstLot ? firstLot.path : 'ring full, no host lot'}`,
      );
      continue;
    }
    const { bx, bz, x, z, rotY } = spot;

    const extra = mergedInto.get(dir.path) ?? 0;
    const lot: LotSpec = {
      path: dir.path,
      signText: dir.name + (extra > 0 ? ` +${extra} more` : ''),
      archetypeId,
      fileCount: dir.fileCount,
      totalSize: dir.totalSize,
      mergedCount: extra,
      x,
      z,
      rotationY: rotY,
      footprint,
      // Door sits on the cell boundary the lot faces.
      doorX: edgeIdx === 1 ? r.x1 : edgeIdx === 3 ? r.x0 : bx,
      doorZ: edgeIdx === 0 ? r.z0 : edgeIdx === 2 ? r.z1 : bz,
      district: districtOf(dir.path),
      candidates,
    };
    lots.push(lot);
    if (!dir.forcedArchetype) firstLot ??= lot; // amenities never host merges
    debugLines.push(`lot: ${dir.path} (${dir.fileCount} files) → ${archetypeId}`);
  }
  return merged;
}

/**
 * Anti-repetition pass: within a district, no archetype should occupy more
 * than about half the lots when alternates exist. Over-represented lots are
 * swapped to their next-best candidate (footprint only ever shrinks, so
 * swaps can't create overlaps). Deterministic: lot order is deterministic.
 */
function diversify(lots: LotSpec[], debugLines: string[]): void {
  const byDistrict = new Map<string, LotSpec[]>();
  for (const lot of lots) {
    if (lot.district === 'plaza') continue;
    let arr = byDistrict.get(lot.district);
    if (!arr) {
      arr = [];
      byDistrict.set(lot.district, arr);
    }
    arr.push(lot);
  }
  for (const group of byDistrict.values()) {
    const limit = Math.max(1, Math.ceil(group.length / 2));
    const counts = new Map<string, number>();
    for (const lot of group) {
      counts.set(lot.archetypeId, (counts.get(lot.archetypeId) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count <= limit) continue;
      let excess = count - limit;
      // Swap from the end so the district's "first" lot keeps its identity.
      for (let i = group.length - 1; i >= 0 && excess > 0; i--) {
        const lot = group[i];
        if (!lot || lot.archetypeId !== id) continue;
        const alt = lot.candidates.find(
          (cand) => cand !== id && (counts.get(cand) ?? 0) < limit,
        );
        if (alt === undefined) continue;
        lot.archetypeId = alt;
        lot.footprint = instanceFootprint(alt, {
          path: lot.path,
          fileCount: lot.fileCount,
          maxFootprint: lot.footprint,
        });
        counts.set(alt, (counts.get(alt) ?? 0) + 1);
        counts.set(id, (counts.get(id) ?? 0) - 1);
        excess--;
        debugLines.push(`diversified: ${lot.path} ${id} → ${alt}`);
      }
    }
  }
}

// d3 namespace import for the rectangular node type only.
import type * as d3 from 'd3-hierarchy';
