import * as THREE from 'three';
import { PALETTE } from './palette';
import type { RoadGraph, RoadNode, RoadEdge } from './types';

// --- Road tuning -----------------------------------------------------------
export const ROAD_CONFIG = {
  /** Demo test grid: tile x of each avenue, tile z of each street, extents. */
  avenueX: [30, 46],
  streetZ: [28, 38, 48],
  gridMin: 22,
  gridMax: 56,
  /** Total road width (sidewalk to sidewalk), world units. */
  roadWidth: 2,
  /** Sidewalk width on each side, world units. */
  sidewalkWidth: 0.35,
  /** Road surface height above terrain, avoids z-fighting with the ground. */
  surfaceY: 0.02,
  /** Debug graph overlay height above the road surface. */
  overlayY: 0.15,
  /** Road texture: pixels across the width and along one dash cycle. */
  texSizePx: 16,
  /** Dash length fraction of one texture repeat (rest is gap). */
  dashFraction: 0.5,
  /** World length of one dash cycle (one texture repeat). */
  dashCycleLength: 2,
  /** Coordinates are keyed to this precision when deduping graph nodes. */
  nodeEpsilon: 0.001,
} as const;

/** Original bridge look: flat concrete deck on trestle piers, road surface
 * continuing across the top. Heights are world units above the water plane
 * (y = 0). traffic.ts lifts vehicles onto the deck from these same numbers. */
export const BRIDGE_CONFIG = {
  /** Road surface height on the deck (the deck's top face). */
  deckTopY: 0.3,
  /** Deck slab thickness. */
  deckThickness: 0.12,
  /** Deck width beyond the road width (kerb overhang on each side). */
  deckOverhang: 0.5,
  /** Pier spacing along the span, world units. */
  pierSpacing: 3,
  /** Pier footprint along the span direction. */
  pierDepth: 0.5,
} as const;

/**
 * One axis-aligned road centerline. axis 'z' runs along z at x=c (an avenue);
 * axis 'x' runs along x at z=c (a street). Span is [a, b] in world units.
 */
export interface RoadSegmentSpec {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
}

/** Paints one road cross-section strip: sidewalk / asphalt / dashes / asphalt / sidewalk. */
function buildRoadTexture(): THREE.CanvasTexture {
  const c = ROAD_CONFIG;
  const s = c.texSizePx;
  const canvas = document.createElement('canvas');
  canvas.width = s; // across the road width
  canvas.height = s; // along the road (one dash cycle)
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  const sidewalkPx = Math.round((c.sidewalkWidth / c.roadWidth) * s);
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = PALETTE.sidewalk;
  ctx.fillRect(0, 0, sidewalkPx, s);
  ctx.fillRect(s - sidewalkPx, 0, sidewalkPx, s);
  // Center dash: 1px wide, dashFraction of the cycle long.
  ctx.fillStyle = PALETTE.dash;
  ctx.fillRect(Math.floor(s / 2), 0, 1, Math.round(s * c.dashFraction));

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Plain asphalt for intersection patches. */
function buildIntersectionTexture(): THREE.CanvasTexture {
  const s = ROAD_CONFIG.texSizePx;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, s, s);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface BuiltRoads {
  group: THREE.Group;
  graph: RoadGraph;
  /** Toggleable debug overlay drawing the routing graph; starts hidden. */
  debugOverlay: THREE.Object3D;
  dispose: () => void;
}

/** A standalone piece (Edit Mode): meshes only, no graph, no traffic. */
export interface RoadPieceHandle {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Decorative road strip for the Edit Mode sandbox: identical art to a real
 * road (asphalt, sidewalks, dashes), centered at origin along `axis`, but
 * NEVER part of the routing graph — traffic only drives the honest generated
 * network.
 */
export function buildRoadPiece(axis: 'x' | 'z', length: number): RoadPieceHandle {
  const c = ROAD_CONFIG;
  const texture = buildRoadTexture();
  const mat = new THREE.MeshBasicMaterial({ map: texture });
  const geo = new THREE.PlaneGeometry(c.roadWidth, length);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (length / c.dashCycleLength));
  if (axis === 'x') geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = c.surfaceY;
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      texture.dispose();
    },
  };
}

/**
 * Decorative bridge piece (Edit Mode): the same deck + trestle piers + road
 * surface look as a real bridge, centered at origin along `axis`. Purely
 * visual — no graph edge, no vehicle lift.
 */
export function buildBridgePiece(axis: 'x' | 'z', length: number): RoadPieceHandle {
  const c = ROAD_CONFIG;
  const bc = BRIDGE_CONFIG;
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const texture = buildRoadTexture();
  const roadMat = new THREE.MeshBasicMaterial({ map: texture });
  const deckMat = new THREE.MeshBasicMaterial({ color: PALETTE.sidewalk });

  const roadGeo = new THREE.PlaneGeometry(c.roadWidth, length);
  roadGeo.rotateX(-Math.PI / 2);
  const uv = roadGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (length / c.dashCycleLength));
  if (axis === 'x') roadGeo.rotateY(Math.PI / 2);
  geometries.push(roadGeo);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.y = bc.deckTopY + 0.005;
  group.add(road);

  const deckGeo = new THREE.BoxGeometry(
    axis === 'z' ? c.roadWidth + bc.deckOverhang : length,
    bc.deckThickness,
    axis === 'z' ? length : c.roadWidth + bc.deckOverhang,
  );
  geometries.push(deckGeo);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = bc.deckTopY - bc.deckThickness / 2;
  group.add(deck);

  const pierH = bc.deckTopY - bc.deckThickness;
  const pierCount = Math.max(1, Math.floor(length / bc.pierSpacing));
  for (let i = 1; i <= pierCount; i++) {
    const along = -length / 2 + (length * i) / (pierCount + 1);
    const pierGeo = new THREE.BoxGeometry(
      axis === 'z' ? c.roadWidth : bc.pierDepth,
      pierH,
      axis === 'z' ? bc.pierDepth : c.roadWidth,
    );
    geometries.push(pierGeo);
    const pier = new THREE.Mesh(pierGeo, deckMat);
    pier.position.set(axis === 'z' ? 0 : along, pierH / 2, axis === 'z' ? along : 0);
    group.add(pier);
  }

  return {
    group,
    dispose: () => {
      for (const g of geometries) g.dispose();
      roadMat.dispose();
      deckMat.dispose();
      texture.dispose();
    },
  };
}

interface NormalizedSegment {
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
  /** Sorted positions along the span where another road crosses. */
  crossings: number[];
}

/** Merge same-line overlapping/touching spans so duplicates can't double-draw. */
function normalize(specs: RoadSegmentSpec[]): NormalizedSegment[] {
  const eps = ROAD_CONFIG.nodeEpsilon;
  const byLine = new Map<string, { axis: 'x' | 'z'; c: number; spans: [number, number][] }>();
  for (const s of specs) {
    const lo = Math.min(s.a, s.b);
    const hi = Math.max(s.a, s.b);
    if (hi - lo < eps) continue;
    const key = `${s.axis}:${s.c.toFixed(3)}`;
    let line = byLine.get(key);
    if (!line) {
      line = { axis: s.axis, c: s.c, spans: [] };
      byLine.set(key, line);
    }
    line.spans.push([lo, hi]);
  }
  const out: NormalizedSegment[] = [];
  for (const line of byLine.values()) {
    line.spans.sort((p, q) => p[0] - q[0]);
    let cur: [number, number] | null = null;
    for (const span of line.spans) {
      if (cur && span[0] <= cur[1] + eps) {
        cur[1] = Math.max(cur[1], span[1]);
      } else {
        if (cur) out.push({ axis: line.axis, c: line.c, a: cur[0], b: cur[1], crossings: [] });
        cur = [span[0], span[1]];
      }
    }
    if (cur) out.push({ axis: line.axis, c: line.c, a: cur[0], b: cur[1], crossings: [] });
  }
  return out;
}

/**
 * Builds meshes + routing graph from raw centerline specs. Segments are split
 * at every crossing (including T-junctions); intersection patches drawn at
 * crossings; graph nodes at crossings and true road ends, edges with
 * precomputed lengths.
 */
export function buildRoadNetwork(
  specs: RoadSegmentSpec[],
  bridges: RoadSegmentSpec[] = [],
): BuiltRoads {
  const c = ROAD_CONFIG;
  const eps = c.nodeEpsilon;
  const half = c.roadWidth / 2;
  const segments = normalize(specs);

  // Find crossings between perpendicular segments (inclusive bounds → T-junctions count).
  const crossingKeys = new Set<string>();
  const vs = segments.filter((s) => s.axis === 'z');
  const hs = segments.filter((s) => s.axis === 'x');
  for (const v of vs) {
    for (const h of hs) {
      const x = v.c;
      const z = h.c;
      if (x >= h.a - eps && x <= h.b + eps && z >= v.a - eps && z <= v.b + eps) {
        v.crossings.push(z);
        h.crossings.push(x);
        crossingKeys.add(`${x.toFixed(3)},${z.toFixed(3)}`);
      }
    }
  }

  // Graph assembly with deduped nodes.
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const idAt = new Map<string, number>();
  const nodeId = (x: number, z: number): number => {
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    const existing = idAt.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push({ id, x, z });
    idAt.set(key, id);
    return id;
  };

  const group = new THREE.Group();
  const roadTexture = buildRoadTexture();
  const interTexture = buildIntersectionTexture();
  const roadMat = new THREE.MeshBasicMaterial({ map: roadTexture });
  const interMat = new THREE.MeshBasicMaterial({ map: interTexture });
  const deckMat = new THREE.MeshBasicMaterial({ color: PALETTE.sidewalk });
  const geometries: THREE.BufferGeometry[] = [];

  /** Strip piece that crosses a pond on a bridge: matched by line + overlap. */
  const bridgeFor = (
    axis: 'x' | 'z',
    center: number,
    from: number,
    to: number,
  ): RoadSegmentSpec | undefined =>
    bridges.find(
      (b) =>
        b.axis === axis && Math.abs(b.c - center) < eps && from < b.b - eps && to > b.a + eps,
    );

  /** Deck slab + trestle piers under an elevated strip (original, no game art). */
  const addBridgeWorks = (axis: 'x' | 'z', center: number, from: number, to: number): void => {
    const bc = BRIDGE_CONFIG;
    const length = to - from;
    const mid = (from + to) / 2;
    const deckGeo = new THREE.BoxGeometry(
      axis === 'z' ? c.roadWidth + bc.deckOverhang : length,
      bc.deckThickness,
      axis === 'z' ? length : c.roadWidth + bc.deckOverhang,
    );
    geometries.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(
      axis === 'z' ? center : mid,
      bc.deckTopY - bc.deckThickness / 2,
      axis === 'z' ? mid : center,
    );
    group.add(deck);
    const pierH = bc.deckTopY - bc.deckThickness;
    const pierCount = Math.max(1, Math.floor(length / bc.pierSpacing));
    for (let i = 1; i <= pierCount; i++) {
      const along = from + (length * i) / (pierCount + 1);
      const pierGeo = new THREE.BoxGeometry(
        axis === 'z' ? c.roadWidth : bc.pierDepth,
        pierH,
        axis === 'z' ? bc.pierDepth : c.roadWidth,
      );
      geometries.push(pierGeo);
      const pier = new THREE.Mesh(pierGeo, deckMat);
      pier.position.set(
        axis === 'z' ? center : along,
        pierH / 2,
        axis === 'z' ? along : center,
      );
      group.add(pier);
    }
  };

  const addStrip = (axis: 'x' | 'z', center: number, from: number, to: number): void => {
    const length = to - from;
    if (length < eps) return;
    const bridge = bridgeFor(axis, center, from, to);
    const geo = new THREE.PlaneGeometry(c.roadWidth, length);
    geo.rotateX(-Math.PI / 2);
    // Repeat the dash cycle along the strip length.
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, uv.getY(i) * (length / c.dashCycleLength));
    }
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, roadMat);
    const mid = (from + to) / 2;
    const y = bridge ? BRIDGE_CONFIG.deckTopY + 0.005 : c.surfaceY;
    mesh.position.set(axis === 'z' ? center : mid, y, axis === 'z' ? mid : center);
    group.add(mesh);
    if (bridge) addBridgeWorks(axis, center, from, to);
  };

  for (const seg of segments) {
    const cuts = [seg.a, ...seg.crossings, seg.b]
      .sort((p, q) => p - q)
      .filter((v, i, arr) => i === 0 || v - (arr[i - 1] ?? v) > eps);
    for (let i = 0; i < cuts.length - 1; i++) {
      const p = cuts[i];
      const q = cuts[i + 1];
      if (p === undefined || q === undefined) continue;
      // Graph edge between consecutive cut points.
      const pa = seg.axis === 'z' ? nodeId(seg.c, p) : nodeId(p, seg.c);
      const pb = seg.axis === 'z' ? nodeId(seg.c, q) : nodeId(q, seg.c);
      edges.push({ a: pa, b: pb, length: q - p });
      // Mesh strip, pulled back at crossing ends so the patch owns the corner.
      const pKey =
        seg.axis === 'z'
          ? `${seg.c.toFixed(3)},${p.toFixed(3)}`
          : `${p.toFixed(3)},${seg.c.toFixed(3)}`;
      const qKey =
        seg.axis === 'z'
          ? `${seg.c.toFixed(3)},${q.toFixed(3)}`
          : `${q.toFixed(3)},${seg.c.toFixed(3)}`;
      const from = crossingKeys.has(pKey) ? p + half : p;
      const to = crossingKeys.has(qKey) ? q - half : q;
      addStrip(seg.axis, seg.c, from, to);
    }
  }

  // Intersection patches.
  for (const key of crossingKeys) {
    const [xs, zs] = key.split(',');
    if (xs === undefined || zs === undefined) continue;
    const geo = new THREE.PlaneGeometry(c.roadWidth, c.roadWidth);
    geo.rotateX(-Math.PI / 2);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, interMat);
    mesh.position.set(Number(xs), c.surfaceY, Number(zs));
    group.add(mesh);
  }

  const graph: RoadGraph = { nodes, edges };
  const overlay = buildGraphOverlay(graph);
  overlay.object.visible = false;
  group.add(overlay.object);
  geometries.push(overlay.geometry);

  return {
    group,
    graph,
    debugOverlay: overlay.object,
    dispose: () => {
      for (const g of geometries) g.dispose();
      roadMat.dispose();
      interMat.dispose();
      deckMat.dispose();
      roadTexture.dispose();
      interTexture.dispose();
      overlay.material.dispose();
    },
  };
}

/** The Phase 1 hand-coded test grid, expressed through the shared network API. */
export function buildRoads(): BuiltRoads {
  const c = ROAD_CONFIG;
  const specs: RoadSegmentSpec[] = [];
  for (const ax of c.avenueX) specs.push({ axis: 'z', c: ax, a: c.gridMin, b: c.gridMax });
  for (const sz of c.streetZ) specs.push({ axis: 'x', c: sz, a: c.gridMin, b: c.gridMax });
  return buildRoadNetwork(specs);
}

// --- Graph analysis (the correctness gate for traffic) ----------------------

export interface GraphReport {
  nodeCount: number;
  edgeCount: number;
  /** Number of connected components (must be 1). */
  components: number;
  /** Node ids with degree < 2 (dangling ends). */
  danglingNodes: number[];
}

/** Connectivity + degree analysis via union-find; used by the 2A self-check. */
export function analyzeGraph(graph: RoadGraph): GraphReport {
  const n = graph.nodes.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== undefined && parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== undefined && parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const degree = new Array<number>(n).fill(0);
  for (const e of graph.edges) {
    degree[e.a] = (degree[e.a] ?? 0) + 1;
    degree[e.b] = (degree[e.b] ?? 0) + 1;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  const dangling: number[] = [];
  for (let i = 0; i < n; i++) {
    if ((degree[i] ?? 0) < 2) dangling.push(i);
  }
  return {
    nodeCount: n,
    edgeCount: graph.edges.length,
    components: n === 0 ? 0 : roots.size,
    danglingNodes: dangling,
  };
}

/** Yellow line segments tracing every graph edge, plus node tick marks. */
function buildGraphOverlay(graph: RoadGraph): {
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
} {
  const c = ROAD_CONFIG;
  const tick = 0.3; // node marker cross half-size, world units
  const positions: number[] = [];
  for (const e of graph.edges) {
    const a = graph.nodes[e.a];
    const b = graph.nodes[e.b];
    if (!a || !b) continue;
    positions.push(a.x, c.overlayY, a.z, b.x, c.overlayY, b.z);
  }
  for (const n of graph.nodes) {
    positions.push(n.x - tick, c.overlayY, n.z, n.x + tick, c.overlayY, n.z);
    positions.push(n.x, c.overlayY, n.z - tick, n.x, c.overlayY, n.z + tick);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: PALETTE.selection });
  return { object: new THREE.LineSegments(geometry, material), geometry, material };
}
