import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, FLEET_PALETTE } from './palette';
import { newKit, box, type PartKit } from './buildings';
import { hashPath } from './archetypes';
import type { RoadGraph } from './types';
import type { CityLayout } from './layout';
import { ROAD_CONFIG, BRIDGE_CONFIG } from './roads';
import type { VehicleAssignment, VehicleTypeId } from './trafficstops';

// --- Traffic tuning --------------------------------------------------------------
export const TRAFFIC_CONFIG = {
  /** Right-hand lane offset from the road centerline, world units. */
  laneOffset: 0.33,
  /** Cruise speed, world units per second. */
  speed: 3.0,
  /** Per-vehicle constant speed variance (±fraction), hash-seeded. */
  speedJitterFrac: 0.08,
  /** Loop start stagger (0..this many seconds, hash-seeded) so identical
   * routes don't spawn in lockstep convoys. */
  startStaggerMaxSec: 3.5,
  /** Anti-convoy: ease off when close behind a same-lane vehicle. */
  followDistance: 1.15,
  followSlowFactor: 0.35,
  /** Parking rank at stop nodes: setback of the first slot, spacing between
   * slots, and how many slots rotate before reuse. Slots are assigned
   * round-robin per node as vehicles arrive, so a popular stop (the plaza)
   * spreads its parkers into a rank instead of stacking them. */
  parkBackMin: 0.3,
  parkSlotSpacing: 0.5,
  parkSlots: 7,
  /** Small per-vehicle lateral parking/driving jitter within the lane. */
  laneJitterMax: 0.09,
  /** Extra per-vehicle-index start delay: guarantees distinct launch times
   * even when two same-lot vehicles hash to near-identical staggers. */
  indexStaggerSec: 0.12,
  /** Body color jitter around the language hue (saturation / lightness
   * spans), so same-language fleets read as a varied family of shades. */
  bodySatJitter: 0.22,
  bodyLightJitter: 0.26,
  /** Fast-forward multiplier for the speed control. */
  fastMultiplier: 3,
  /** Idle pause at each loop stop, seconds (±jitter fraction below). Without
   * the jitter, identical-route vehicles phase-lock: equal pauses at shared
   * stops re-synchronize them no matter the speed variance. */
  stopPauseSec: 2.2,
  stopPauseJitterFrac: 0.45,
  /** Vehicle ride height above ground. */
  vehicleY: 0.05,
  /** Active vehicle budget. Measured on metropolis (248 buildings): 160
   * vehicles held 60fps with ~35% frame headroom; see phase notes. */
  maxVehicles: 160,
  /** The degrade guardrail never goes below this. */
  minVehicles: 24,
  /** Frame-time budget; sustained frames above this shed vehicles first. */
  frameBudgetMs: 17,
  degradeCheckSec: 1.5,
  degradeStep: 16,
  /** No degrade checks during the first seconds: city founding blocks the
   * main thread and would otherwise trip the guardrail on a false spike. */
  degradeWarmupSec: 3,
  /** Exponential yaw easing rate (higher = snappier turns). */
  yawEase: 9,
} as const;

// --- Vehicle silhouettes -----------------------------------------------------------
// Each type is 3–6 stacked boxes, nose toward +z. Body parts bake WHITE so
// the per-instance language color tints them; trim parts keep fixed colors.

interface VehicleGeo {
  body: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
}

const WHEEL = PALETTE.roofSlate;
const GLASS = PALETTE.glassDark;

function axles(trim: PartKit, w: number, zFront: number, zRear: number): void {
  box(trim, WHEEL, w, 0.09, 0.16, 0, 0, zFront);
  box(trim, WHEEL, w, 0.09, 0.16, 0, 0, zRear);
}

/** Silhouette builders; sizes in world units (roads are 2 wide). */
const VEHICLE_BUILDERS: Record<VehicleTypeId, (bodyKit: PartKit, trimKit: PartKit) => void> = {
  sedan: (b, t) => {
    box(b, '#ffffff', 0.4, 0.14, 0.92, 0, 0.07, 0);
    box(b, '#ffffff', 0.36, 0.13, 0.48, 0, 0.21, -0.06);
    box(t, GLASS, 0.3, 0.08, 0.5, 0, 0.22, -0.06);
    axles(t, 0.44, 0.28, -0.28);
  },
  taxi: (b, t) => {
    box(b, '#ffffff', 0.4, 0.14, 0.92, 0, 0.07, 0);
    box(b, '#ffffff', 0.36, 0.13, 0.48, 0, 0.21, -0.06);
    box(t, PALETTE.selection, 0.1, 0.07, 0.2, 0, 0.34, -0.06); // roof sign
    box(t, GLASS, 0.3, 0.07, 0.5, 0, 0.22, -0.06);
    axles(t, 0.44, 0.28, -0.28);
  },
  van: (b, t) => {
    box(b, '#ffffff', 0.44, 0.3, 0.94, 0, 0.07, -0.04);
    box(b, '#ffffff', 0.4, 0.16, 0.18, 0, 0.07, 0.42); // hood
    box(t, GLASS, 0.38, 0.1, 0.06, 0, 0.24, 0.33); // windshield
    axles(t, 0.48, 0.3, -0.3);
  },
  'box-truck': (b, t) => {
    box(b, '#ffffff', 0.42, 0.24, 0.3, 0, 0.07, 0.36); // cab
    box(t, GLASS, 0.36, 0.09, 0.05, 0, 0.2, 0.51);
    box(b, '#ffffff', 0.5, 0.4, 0.62, 0, 0.07, -0.18); // cargo box
    axles(t, 0.52, 0.38, -0.3);
  },
  bus: (b, t) => {
    box(b, '#ffffff', 0.46, 0.34, 1.3, 0, 0.07, 0);
    box(t, GLASS, 0.48, 0.09, 1.05, 0, 0.25, 0); // window band
    box(t, PALETTE.dash, 0.4, 0.04, 1.2, 0, 0.41, 0); // roof strip
    axles(t, 0.5, 0.42, -0.42);
  },
  motorcycle: (b, t) => {
    box(b, '#ffffff', 0.12, 0.1, 0.5, 0, 0.09, 0);
    box(t, WHEEL, 0.06, 0.14, 0.14, 0, 0.0, 0.22);
    box(t, WHEEL, 0.06, 0.14, 0.14, 0, 0.0, -0.22);
    box(t, PALETTE.roofSlate, 0.12, 0.16, 0.14, 0, 0.19, -0.08); // rider
  },
  pickup: (b, t) => {
    box(b, '#ffffff', 0.42, 0.22, 0.44, 0, 0.07, 0.22); // cab
    box(t, GLASS, 0.36, 0.08, 0.05, 0, 0.21, 0.43);
    box(b, '#ffffff', 0.42, 0.1, 0.44, 0, 0.07, -0.26); // bed floor
    box(t, WHEEL, 0.42, 0.06, 0.05, 0, 0.17, -0.46); // tailgate lip
    axles(t, 0.46, 0.3, -0.3);
  },
  'garbage-truck': (b, t) => {
    box(b, '#ffffff', 0.44, 0.24, 0.3, 0, 0.07, 0.38); // cab
    box(t, PALETTE.industrial, 0.5, 0.34, 0.6, 0, 0.07, -0.14); // hopper
    box(t, PALETTE.industrial, 0.42, 0.12, 0.4, 0, 0.41, -0.1); // hopper top
    axles(t, 0.52, 0.4, -0.3);
  },
  'mail-truck': (b, t) => {
    box(b, '#ffffff', 0.44, 0.3, 0.9, 0, 0.07, 0);
    box(t, PALETTE.dash, 0.46, 0.07, 0.86, 0, 0.2, 0); // white stripe
    box(t, GLASS, 0.38, 0.09, 0.05, 0, 0.26, 0.45);
    axles(t, 0.48, 0.3, -0.3);
  },
  emergency: (b, t) => {
    box(b, '#ffffff', 0.42, 0.26, 0.9, 0, 0.07, 0);
    box(t, PALETTE.roofRed, 0.1, 0.07, 0.12, -0.08, 0.35, -0.02); // light bar
    box(t, PALETTE.glassLight, 0.1, 0.07, 0.12, 0.08, 0.35, -0.02);
    box(t, GLASS, 0.36, 0.09, 0.05, 0, 0.24, 0.44);
    axles(t, 0.46, 0.28, -0.28);
  },
};

export const VEHICLE_TYPES = Object.keys(VEHICLE_BUILDERS) as VehicleTypeId[];

function buildVehicleGeo(type: VehicleTypeId): VehicleGeo {
  const bodyKit = newKit();
  const trimKit = newKit();
  VEHICLE_BUILDERS[type](bodyKit, trimKit);
  const body = mergeGeometries(bodyKit.solids, false);
  const trim = mergeGeometries(trimKit.solids, false);
  for (const g of bodyKit.solids) g.dispose();
  for (const g of trimKit.solids) g.dispose();
  if (!body || !trim) throw new Error(`vehicle geometry failed: ${type}`);
  return { body, trim };
}

// --- Scratch (module scope: the update loop allocates nothing) ---------------------
const scratchMatrix = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3(1, 1, 1);
const scratchColor = new THREE.Color();
const scratchHSL = { h: 0, s: 0, l: 0 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Trim tint palette: pastel multipliers over the trim's baked colors, so
 * side-by-side vehicles differ in roof/stripe accents at a glance. Bright
 * trim (stripes, roof strips) shows the tint clearly; dark wheels barely
 * shift. Hash-seeded per vehicle. */
const TRIM_TINTS: readonly string[] = [
  '#ffffff',
  '#f2e2a0', // warm cream
  '#d0e0ff', // cool blue-white
  '#ffd8d8', // faded rose
  '#d8f0d8', // mint
  '#e8d8c0', // tan
];

interface VehicleState {
  assignment: VehicleAssignment;
  typeSlot: number;
  /** Route polyline (node coords), traversed forward then backward forever. */
  route: Float32Array; // [x0,z0, x1,z1, ...]
  wpCount: number;
  seg: number; // current segment index (dir-dependent)
  segDist: number; // distance advanced along current segment
  dir: 1 | -1;
  pause: number;
  yaw: number;
  speed: number;
  /** Last written world position + heading (for the following-distance check). */
  px: number;
  pz: number;
  hx: number;
  hz: number;
  /** Constant lateral offset within the lane, hash-seeded. */
  laneJitter: number;
  /** Graph node ids at the route's two ends (for parking-slot rotation). */
  nodeA: number;
  nodeB: number;
}

/**
 * The vehicle fleet: one InstancedMesh pair (body + trim) per type, routes
 * precomputed at spawn on the REAL road graph (ring roads and interior
 * sub-roads included), never per-frame pathfinding.
 */
export class Traffic {
  /** 0 = paused, 1 = play, fastMultiplier = fast. */
  speedMultiplier = 1;
  private readonly vehicles: VehicleState[] = [];
  private readonly meshes = new Map<
    VehicleTypeId,
    { body: THREE.InstancedMesh; trim: THREE.InstancedMesh }
  >();
  private readonly geos: VehicleGeo[] = [];
  private readonly typeVehicles = new Map<VehicleTypeId, number[]>();
  private activeCount: number;
  private frameEma = 16;
  private degradeTimer = 0;
  private warmup = TRAFFIC_CONFIG.degradeWarmupSec;
  /** Round-robin parking slot counter per stop node. */
  private readonly parkCounter = new Map<number, number>();
  private readonly group = new THREE.Group();
  /** Bridge spans (from layout): vehicles lift onto the deck while crossing. */
  private readonly bridges: { axis: 'x' | 'z'; c: number; a: number; b: number }[];

  constructor(
    scene: THREE.Scene,
    assignments: VehicleAssignment[],
    layout: CityLayout,
    graph: RoadGraph,
  ) {
    const c = TRAFFIC_CONFIG;
    this.bridges = layout.bridges ?? [];
    // Adjacency for Dijkstra (built once; routing itself reuses arrays).
    const n = graph.nodes.length;
    const adj: { to: number; len: number }[][] = Array.from({ length: n }, () => []);
    for (const e of graph.edges) {
      adj[e.a]?.push({ to: e.b, len: e.length });
      adj[e.b]?.push({ to: e.a, len: e.length });
    }
    const dist = new Float64Array(n);
    const prev = new Int32Array(n);
    const done = new Uint8Array(n);
    const nearestNode = (x: number, z: number): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const node = graph.nodes[i];
        if (!node) continue;
        const d = (node.x - x) ** 2 + (node.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    /** O(n^2) Dijkstra — fine at ~200 nodes, runs once per vehicle at spawn. */
    const shortestPath = (from: number, to: number): number[] => {
      dist.fill(Infinity);
      prev.fill(-1);
      done.fill(0);
      dist[from] = 0;
      for (;;) {
        let u = -1;
        let ud = Infinity;
        for (let i = 0; i < n; i++) {
          if (!done[i] && (dist[i] ?? Infinity) < ud) {
            ud = dist[i] ?? Infinity;
            u = i;
          }
        }
        if (u === -1 || u === to) break;
        done[u] = 1;
        for (const edge of adj[u] ?? []) {
          const nd = ud + edge.len;
          if (nd < (dist[edge.to] ?? Infinity)) {
            dist[edge.to] = nd;
            prev[edge.to] = u;
          }
        }
      }
      const path: number[] = [];
      for (let at = to; at !== -1; at = prev[at] ?? -1) path.push(at);
      path.reverse();
      return path[0] === from ? path : [from];
    };

    for (const a of assignments.slice(0, c.maxVehicles)) {
      const home = layout.lots[a.homeLotIndex];
      const stop = layout.lots[a.stopLotIndex];
      if (!home || !stop) continue;
      const fromNode = nearestNode(home.doorX, home.doorZ);
      const toNode = nearestNode(stop.doorX, stop.doorZ);
      let path = shortestPath(fromNode, toNode);
      if (path.length < 2) {
        const neighbor = adj[fromNode]?.[0]?.to;
        if (neighbor === undefined) continue; // isolated node: no vehicle
        path = [fromNode, neighbor];
      }
      const route = new Float32Array(path.length * 2);
      path.forEach((nodeId, i) => {
        const node = graph.nodes[nodeId];
        route[i * 2] = node?.x ?? 0;
        route[i * 2 + 1] = node?.z ?? 0;
      });
      let slots = this.typeVehicles.get(a.typeId);
      if (!slots) {
        slots = [];
        this.typeVehicles.set(a.typeId, slots);
      }
      const hash = hashPath(a.filePath);
      const state: VehicleState = {
        assignment: a,
        typeSlot: slots.length,
        route,
        wpCount: path.length,
        seg: 0,
        segDist: (hash % 100) / 100,
        dir: 1,
        // Anti-convoy: seeded start delay so shared routes don't run
        // lockstep; the index term makes launch times strictly distinct.
        pause:
          (((hash >>> 6) % 100) / 100) * c.startStaggerMaxSec +
          (this.vehicles.length % 30) * c.indexStaggerSec,
        yaw: 0,
        // Anti-convoy: constant ±8% cruise variance, also seeded.
        speed: c.speed * (1 + (((hash >>> 12) % 100) / 100 - 0.5) * 2 * c.speedJitterFrac),
        px: route[0] ?? 0,
        pz: route[1] ?? 0,
        hx: 0,
        hz: 0,
        laneJitter: (((hash >>> 20) % 100) / 100 - 0.5) * 2 * c.laneJitterMax,
        nodeA: path[0] ?? 0,
        nodeB: path[path.length - 1] ?? 0,
      };
      slots.push(this.vehicles.length);
      this.vehicles.push(state);
    }
    this.activeCount = this.vehicles.length;

    // One InstancedMesh pair per type actually present.
    for (const [typeId, slots] of this.typeVehicles) {
      const geo = buildVehicleGeo(typeId);
      this.geos.push(geo);
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      const body = new THREE.InstancedMesh(geo.body, material, slots.length);
      const trim = new THREE.InstancedMesh(geo.trim, material, slots.length);
      body.userData.vehicleType = typeId; // raycast → vehicle lookup
      slots.forEach((vehicleIdx, slot) => {
        const v = this.vehicles[vehicleIdx];
        const lang = v?.assignment.language ?? 'other';
        const hash = hashPath(v?.assignment.filePath ?? String(slot));
        // Body: the language hue stays the recognizable base family; only
        // saturation/lightness jitter per vehicle (hash-seeded, honest).
        scratchColor.set(FLEET_PALETTE[lang]);
        scratchColor.getHSL(scratchHSL);
        const satJit = (((hash >>> 3) % 100) / 100 - 0.5) * c.bodySatJitter;
        const lightJit = (((hash >>> 9) % 100) / 100 - 0.5) * c.bodyLightJitter;
        scratchColor.setHSL(
          scratchHSL.h,
          Math.min(1, Math.max(0.05, scratchHSL.s + satJit)),
          Math.min(0.8, Math.max(0.18, scratchHSL.l + lightJit)),
        );
        body.setColorAt(slot, scratchColor);
        // Trim: secondary accent from a small rotating pastel palette.
        scratchColor.set(TRIM_TINTS[(hash >>> 16) % TRIM_TINTS.length] ?? '#ffffff');
        trim.setColorAt(slot, scratchColor);
      });
      this.group.add(body, trim);
      this.meshes.set(typeId, { body, trim });
    }
    // Write every matrix once so vehicles waiting out their launch stagger
    // render parked at their home door, not at the identity transform.
    for (const v of this.vehicles) this.writeMatrix(v, 0);
    scene.add(this.group);
  }

  /** Global vehicle index for a raycast hit on a body mesh. */
  vehicleAt(typeId: VehicleTypeId, instanceId: number): number | null {
    const idx = this.typeVehicles.get(typeId)?.[instanceId];
    return idx !== undefined && idx < this.activeCount ? idx : null;
  }

  vehicleCount(): number {
    return this.activeCount;
  }

  /** Debug/test observability: world position of the first vehicle. */
  debugFirstPosition(): { x: number; z: number } | null {
    for (const { body } of this.meshes.values()) {
      if (body.count > 0) {
        const a = body.instanceMatrix.array;
        return { x: a[12] ?? 0, z: a[14] ?? 0 };
      }
    }
    return null;
  }

  /** Debug/test observability: per-vehicle position + body color + language,
   * for verifying color variety and spacing without screenshots. */
  debugFleet(limit: number): { x: number; z: number; color: string; lang: string }[] {
    const out: { x: number; z: number; color: string; lang: string }[] = [];
    for (const [typeId, slots] of this.typeVehicles) {
      const mesh = this.meshes.get(typeId);
      if (!mesh) continue;
      const m = mesh.body.instanceMatrix.array;
      const colors = mesh.body.instanceColor?.array;
      slots.forEach((vehicleIdx, slot) => {
        if (out.length >= limit || vehicleIdx >= this.activeCount) return;
        const v = this.vehicles[vehicleIdx];
        if (!v) return;
        const r = colors ? Math.round((colors[slot * 3] ?? 0) * 255) : 0;
        const g = colors ? Math.round((colors[slot * 3 + 1] ?? 0) * 255) : 0;
        const b = colors ? Math.round((colors[slot * 3 + 2] ?? 0) * 255) : 0;
        out.push({
          x: Math.round((m[slot * 16 + 12] ?? 0) * 10) / 10,
          z: Math.round((m[slot * 16 + 14] ?? 0) * 10) / 10,
          color: `${r},${g},${b}`,
          lang: v.assignment.language,
        });
      });
    }
    return out;
  }

  /** Counts per type among active vehicles (for the roster view). */
  countsByType(): Map<VehicleTypeId, number> {
    const counts = new Map<VehicleTypeId, number>();
    for (let i = 0; i < this.activeCount; i++) {
      const t = this.vehicles[i]?.assignment.typeId;
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }

  /** Active vehicles that use this lot as home or stop (for building cards). */
  vehiclesUsingLot(lotIndex: number): VehicleAssignment[] {
    const out: VehicleAssignment[] = [];
    for (let i = 0; i < this.activeCount; i++) {
      const v = this.vehicles[i];
      if (
        v &&
        (v.assignment.homeLotIndex === lotIndex || v.assignment.stopLotIndex === lotIndex)
      ) {
        out.push(v.assignment);
      }
    }
    return out;
  }

  /** Assignment + live loop state, for the vehicle query card. */
  vehicleInfo(
    index: number,
  ): { assignment: VehicleAssignment; outbound: boolean; paused: boolean } | null {
    const v = this.vehicles[index];
    if (!v) return null;
    return { assignment: v.assignment, outbound: v.dir === 1, paused: v.pause > 0 };
  }

  /** Advance the fleet. rawDt for the guardrail, scaled dt for motion. */
  update(rawDt: number): void {
    const c = TRAFFIC_CONFIG;
    // Frame-time guardrail: shed vehicles before anything else degrades.
    if (this.warmup > 0) {
      this.warmup -= rawDt;
    } else {
      this.frameEma = this.frameEma * 0.95 + rawDt * 1000 * 0.05;
      this.degradeTimer += rawDt;
    }
    if (this.degradeTimer >= c.degradeCheckSec) {
      this.degradeTimer = 0;
      if (this.frameEma > c.frameBudgetMs && this.activeCount > c.minVehicles) {
        this.activeCount = Math.max(c.minVehicles, this.activeCount - c.degradeStep);
        this.applyActiveCounts();
      }
    }

    const dt = rawDt * this.speedMultiplier;
    if (dt <= 0) return;
    for (let i = 0; i < this.activeCount; i++) {
      const v = this.vehicles[i];
      if (!v) continue;
      if (v.pause > 0) {
        v.pause -= dt;
        continue; // idling at a stop; matrix already parked
      }
      // Anti-convoy: briefly slow when close behind a same-lane vehicle
      // instead of overlapping it (positions/headings are last frame's).
      let advance = v.speed * dt * this.followFactor(i, v);
      let guard = 0;
      while (advance > 0 && guard++ < 8) {
        const ax = v.route[v.seg * 2] ?? 0;
        const az = v.route[v.seg * 2 + 1] ?? 0;
        const next = v.seg + v.dir;
        const bx = v.route[next * 2] ?? ax;
        const bz = v.route[next * 2 + 1] ?? az;
        const segLen = Math.hypot(bx - ax, bz - az) || 0.0001;
        if (v.segDist + advance < segLen) {
          v.segDist += advance;
          advance = 0;
        } else {
          advance -= segLen - v.segDist;
          v.segDist = 0;
          v.seg = next;
          const atEnd = v.dir === 1 ? v.seg >= v.wpCount - 1 : v.seg <= 0;
          if (atEnd) {
            // Park SHORT of the node in a rotating rank slot, so vehicles
            // sharing a stop spread into a queue instead of stacking on one
            // point. Flipping dir first makes segDist valid as progress back
            // along the segment just traversed.
            const nodeId = v.dir === 1 ? v.nodeB : v.nodeA;
            v.dir = v.dir === 1 ? -1 : 1;
            const slot = this.parkCounter.get(nodeId) ?? 0;
            this.parkCounter.set(nodeId, (slot + 1) % c.parkSlots);
            v.segDist = Math.min(c.parkBackMin + slot * c.parkSlotSpacing, segLen * 0.85);
            const hash = hashPath(v.assignment.filePath);
            v.pause =
              c.stopPauseSec *
              (1 + (((hash >>> 18) % 100) / 100 - 0.5) * 2 * c.stopPauseJitterFrac);
            advance = 0;
          }
        }
      }
      this.writeMatrix(v, dt);
    }
    for (const { body, trim } of this.meshes.values()) {
      body.instanceMatrix.needsUpdate = true;
      trim.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 1 = free road; followSlowFactor when another vehicle sits within
   * followDistance directly ahead in the same lane (small lateral offset,
   * roughly same heading — opposing traffic is two lane-offsets away and
   * never triggers this). O(active²) with cheap math: ~160² is well within
   * frame budget, and it allocates nothing.
   */
  private followFactor(selfIndex: number, v: VehicleState): number {
    const c = TRAFFIC_CONFIG;
    let factor = 1;
    for (let j = 0; j < this.activeCount; j++) {
      if (j === selfIndex) continue;
      const o = this.vehicles[j];
      if (!o) continue;
      const dx = o.px - v.px;
      const dz = o.pz - v.pz;
      // Fully overlapped twins (same spawn node + near-identical stagger)
      // have no meaningful "ahead": break the tie by index — the higher
      // index yields until the lower one pulls away. Deadlock-free.
      if (dx * dx + dz * dz < 0.09) {
        if (j < selfIndex) return 0;
        continue;
      }
      const ahead = dx * v.hx + dz * v.hz;
      if (ahead <= 0.05 || ahead > c.followDistance) continue;
      const lateral = Math.abs(dx * -v.hz + dz * v.hx);
      if (lateral > c.laneOffset) continue;
      // Same direction (or parked at a stop): ease off. Opposing traffic
      // fails the lateral test anyway. A soft slow (never a hard stop) keeps
      // spacing without intersection gridlock cascades.
      if (o.pause <= 0 && v.hx * o.hx + v.hz * o.hz < 0.3) continue;
      factor = c.followSlowFactor;
    }
    return factor;
  }

  /**
   * Extra height while a vehicle crosses a bridge span: full deck height over
   * the water, ramping to zero over the last road-half-width at each bank
   * (the deck's road plane starts one half-width past the ring crossing, so
   * the ramp tops out exactly where the deck begins). Zero for nearly every
   * vehicle on nearly every frame — cities have at most a few bridges.
   */
  private bridgeLift(wx: number, wz: number): number {
    if (this.bridges.length === 0) return 0;
    const deckLift = BRIDGE_CONFIG.deckTopY + 0.005 - ROAD_CONFIG.surfaceY;
    const rampLen = ROAD_CONFIG.roadWidth / 2;
    for (const b of this.bridges) {
      const cross = b.axis === 'x' ? wz : wx;
      const along = b.axis === 'x' ? wx : wz;
      if (Math.abs(cross - b.c) > ROAD_CONFIG.roadWidth / 2 + 0.3) continue;
      if (along <= b.a || along >= b.b) continue;
      const edge = Math.min(along - b.a, b.b - along);
      return Math.min(1, edge / rampLen) * deckLift;
    }
    return 0;
  }

  private writeMatrix(v: VehicleState, dt: number): void {
    const c = TRAFFIC_CONFIG;
    const ax = v.route[v.seg * 2] ?? 0;
    const az = v.route[v.seg * 2 + 1] ?? 0;
    const next = v.seg + v.dir;
    const bx = v.route[next * 2] ?? ax;
    const bz = v.route[next * 2 + 1] ?? az;
    const segLen = Math.hypot(bx - ax, bz - az) || 0.0001;
    const dx = (bx - ax) / segLen;
    const dz = (bz - az) / segLen;
    // Right-hand lane: offset toward the travel direction's right side,
    // plus this vehicle's constant in-lane jitter.
    const lane = c.laneOffset + v.laneJitter;
    const ox = -dz * lane;
    const oz = dx * lane;
    const t = v.segDist;
    const wx = ax + dx * t + ox;
    const wz = az + dz * t + oz;
    scratchPos.set(wx, c.vehicleY + this.bridgeLift(wx, wz), wz);
    // Smooth turns: ease yaw toward the segment heading.
    const targetYaw = Math.atan2(dx, dz);
    let delta = targetYaw - v.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    v.yaw += delta * Math.min(1, c.yawEase * dt);
    scratchQuat.setFromAxisAngle(Y_AXIS, v.yaw);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    const mesh = this.meshes.get(v.assignment.typeId);
    if (mesh) {
      mesh.body.setMatrixAt(v.typeSlot, scratchMatrix);
      mesh.trim.setMatrixAt(v.typeSlot, scratchMatrix);
    }
    // Remember position/heading for next frame's following-distance checks.
    v.px = scratchPos.x;
    v.pz = scratchPos.z;
    v.hx = dx;
    v.hz = dz;
  }

  /** After a degrade step, shrink each type's drawn instance range. */
  private applyActiveCounts(): void {
    for (const [typeId, slots] of this.typeVehicles) {
      let visible = 0;
      for (const idx of slots) {
        if (idx < this.activeCount) visible++;
      }
      const mesh = this.meshes.get(typeId);
      if (mesh) {
        mesh.body.count = visible;
        mesh.trim.count = visible;
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { body, trim } of this.meshes.values()) {
      (body.material as THREE.Material).dispose();
      body.dispose();
      trim.dispose();
    }
    for (const geo of this.geos) {
      geo.body.dispose();
      geo.trim.dispose();
    }
    this.vehicles.length = 0;
  }
}
