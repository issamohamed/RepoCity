import { PALETTE } from './palette';
import {
  newKit,
  assemble,
  box,
  cyl,
  cone,
  hipRoof,
  dome,
  texBox,
  type BuildingHandle,
  type PartKit,
} from './buildings';

// --- Archetype tuning ---------------------------------------------------------
export const ARCHETYPE_CONFIG = {
  /** Office tower floors span this range, driven by directory file count. */
  officeFloorsMin: 2,
  officeFloorsMax: 14,
  officeFloorHeight: 0.9,
  /** File count that maps to the tallest tower / most detail. */
  fileCountForMaxHeight: 40,
  /** Tier-2 thresholds: dirs at least this large become offices/apartments. */
  officeFileThreshold: 14,
  apartmentFileThreshold: 9,
} as const;

/** Context a silhouette builds against: everything derives from path/size data. */
export interface BuildCtx {
  kit: PartKit;
  /** Footprint edge length, world units. */
  s: number;
  /** Deterministic 0..1 from the directory path: picks variants. */
  variant: number;
  /** 0..1: file count normalized against fileCountForMaxHeight. */
  heightT: number;
}

export interface ArchetypeSpec {
  id: string;
  category: 'civic' | 'commerce' | 'industry' | 'infra' | 'parks' | 'residential' | 'homes';
  description: string;
  /** Tier 0: exact directory names (lowercase). */
  names?: readonly string[];
  /** Tier 1: path-role patterns tested on the full lowercase path. */
  patterns?: readonly RegExp[];
  /** Only match when the directory has at most this many direct files. */
  maxFiles?: number;
  /** Footprint edge range [min, max], world units. */
  sizeRange: readonly [number, number];
  build: (b: BuildCtx) => void;
}

/** FNV-1a string hash → uint32; deterministic variant picking on rescans. */
export function hashPath(path: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// --- Silhouette helpers ---------------------------------------------------------

/** Row of columns along the front (-z) edge. */
function colonnade(
  kit: PartKit,
  count: number,
  width: number,
  height: number,
  z: number,
): void {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    cyl(kit, PALETTE.concrete, 0.14, 0.14, height, 6, -width / 2 + t * width, 0, z);
  }
}

function frontSteps(kit: PartKit, width: number, z: number): void {
  box(kit, PALETTE.concrete, width, 0.14, 0.5, 0, 0, z);
  box(kit, PALETTE.concrete, width * 0.85, 0.28, 0.3, 0, 0, z - 0.12);
}

// --- The reservoir ---------------------------------------------------------------

export const ARCHETYPES: readonly ArchetypeSpec[] = [
  {
    id: 'city-hall',
    category: 'civic',
    description: 'Repo root: domed civic centerpiece on the plaza',
    sizeRange: [7, 9],
    build: ({ kit, s }) => {
      const w = s;
      const d = s * 0.7;
      texBox(kit, 'civicWindows', w, 2.6, d, 0, 0, 0);
      box(kit, PALETTE.civic, w + 0.5, 0.35, d + 0.5, 0, 2.6, 0);
      box(kit, PALETTE.civic, w * 0.45, 1.1, d * 0.45, 0, 2.95, 0);
      dome(kit, PALETTE.glassDark, w * 0.22, 0, 4.05, 0);
      colonnade(kit, 6, w * 0.7, 2.6, -d / 2 - 0.35);
      frontSteps(kit, w * 0.8, -d / 2 - 0.8);
    },
  },
  {
    id: 'library',
    category: 'civic',
    description: 'lib/, packages/: columned hall, wide stair, pediment',
    names: ['lib', 'libs', 'packages', 'pkg', 'modules'],
    sizeRange: [5, 7],
    build: ({ kit, s }) => {
      const d = s * 0.75;
      texBox(kit, 'civicWindows', s, 2.2, d, 0, 0, 0);
      colonnade(kit, 5, s * 0.75, 2.2, -d / 2 - 0.3);
      box(kit, PALETTE.civic, s + 0.4, 0.3, d + 0.9, 0, 2.2, -0.15);
      hipRoof(kit, PALETTE.civic, s * 0.9, 0.8, d * 0.5, 0, 2.5, -d * 0.2); // pediment mass
      frontSteps(kit, s * 0.9, -d / 2 - 0.75);
    },
  },
  {
    id: 'bank-vault',
    category: 'commerce',
    description: 'secrets/keys/auth: squat stone vault, heavy door, barred windows',
    names: ['secrets', 'keys', 'auth', 'credentials', 'vault', 'certs', 'private'],
    patterns: [/(^|\/)\.env/, /secret/, /credential/],
    sizeRange: [3.5, 5],
    build: ({ kit, s }) => {
      texBox(kit, 'barredWindows', s, 1.8, s * 0.85, 0, 0, 0);
      box(kit, PALETTE.industrial, s + 0.3, 0.4, s * 0.85 + 0.3, 0, 1.8, 0);
      box(kit, PALETTE.roofSlate, 0.9, 1.2, 0.15, 0, 0, -s * 0.425 - 0.07); // heavy door
      box(kit, PALETTE.industrial, 1.2, 0.15, 0.3, 0, 1.2, -s * 0.425 - 0.1);
    },
  },
  {
    id: 'police-station',
    category: 'civic',
    description: 'security/middleware/guards: civic block with a watchtower',
    names: ['security', 'middleware', 'guards', 'guard', 'validation', 'sanitizers'],
    sizeRange: [4, 5.5],
    build: ({ kit, s }) => {
      texBox(kit, 'civicWindows', s, 2, s * 0.8, 0, 0, 0);
      box(kit, PALETTE.concrete, s + 0.3, 0.25, s * 0.8 + 0.3, 0, 2, 0);
      box(kit, PALETTE.concrete, 0.9, 1.6, 0.9, s * 0.28, 2.25, s * 0.15); // watchtower
      box(kit, PALETTE.selection, 0.3, 0.22, 0.3, s * 0.28, 3.85, s * 0.15); // lamp
      frontSteps(kit, s * 0.5, -s * 0.4 - 0.35);
    },
  },
  {
    id: 'courthouse',
    category: 'civic',
    description: 'rules/policies/validators: columned, symmetrical, formal',
    names: ['rules', 'policies', 'policy', 'validators', 'validator', 'schemas', 'schema'],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      const d = s * 0.7;
      texBox(kit, 'civicWindows', s, 2.4, d, 0, 0, 0);
      colonnade(kit, 6, s * 0.85, 2.4, -d / 2 - 0.32);
      box(kit, PALETTE.civic, s + 0.5, 0.35, d + 1, 0, 2.4, -0.15); // entablature
      hipRoof(kit, PALETTE.roofSlate, s * 0.95, 0.7, d * 0.9, 0, 2.75, 0);
      frontSteps(kit, s, -d / 2 - 0.8);
    },
  },
  {
    id: 'school',
    category: 'civic',
    description: 'docs/tutorials: brick school with a clock element',
    names: [
      'docs',
      'doc',
      'documentation',
      'tutorials',
      'tutorial',
      'guides',
      'guide',
      'learn',
      'wiki',
    ],
    sizeRange: [4.5, 6.5],
    build: ({ kit, s }) => {
      texBox(kit, 'brickWindows', s, 2.2, s * 0.6, 0, 0, 0);
      hipRoof(kit, PALETTE.roofBrown, s, 0.8, s * 0.6, 0, 2.2, 0);
      box(kit, PALETTE.brick, 1, 2.9, 1, 0, 0, -s * 0.3 + 0.2); // clock tower
      cyl(kit, PALETTE.dash, 0.3, 0.3, 0.08, 8, 0, 2.45, -s * 0.3 - 0.31, { rx: Math.PI / 2 }); // clock face
      hipRoof(kit, PALETTE.roofBrown, 1.2, 0.5, 1.2, 0, 2.9, -s * 0.3 + 0.2);
    },
  },
  {
    id: 'hospital',
    category: 'civic',
    description: 'logging/monitoring/errors: white block, canopy, plus motif',
    names: [
      'errors',
      'error',
      'logging',
      'logs',
      'log',
      'monitoring',
      'monitor',
      'health',
      'healthcheck',
      'diagnostics',
      'telemetry',
    ],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      texBox(kit, 'smallWindows', s, 3, s * 0.75, 0, 0, 0);
      box(kit, PALETTE.concrete, s + 0.2, 0.25, s * 0.75 + 0.2, 0, 3, 0);
      // Emergency canopy on posts.
      box(kit, PALETTE.concrete, 2.2, 0.18, 1.2, 0, 1.15, -s * 0.375 - 0.6);
      box(kit, PALETTE.concrete, 0.12, 1.15, 0.12, -0.9, 0, -s * 0.375 - 1.05);
      box(kit, PALETTE.concrete, 0.12, 1.15, 0.12, 0.9, 0, -s * 0.375 - 1.05);
      // Original plus-shape motif (not a medical trademark cross).
      box(kit, PALETTE.roofRed, 0.9, 0.28, 0.3, 0, 3.25, 0);
      box(kit, PALETTE.roofRed, 0.3, 0.28, 0.9, 0, 3.25, 0);
    },
  },
  {
    id: 'fire-station',
    category: 'civic',
    description: 'alerts/notifications: tall open bay door, hose tower',
    names: ['alerts', 'alert', 'notifications', 'notification', 'notify'],
    sizeRange: [4, 5.5],
    build: ({ kit, s }) => {
      texBox(kit, 'brickWindows', s, 2.2, s * 0.75, 0, 0, 0);
      box(kit, PALETTE.roofSlate, s * 0.4, 1.8, 0.15, -s * 0.2, 0, -s * 0.375 - 0.08); // open bay
      box(kit, PALETTE.brick, 0.9, 3.2, 0.9, s * 0.3, 0, s * 0.15); // hose tower
      hipRoof(kit, PALETTE.roofRed, 1.1, 0.45, 1.1, s * 0.3, 3.2, s * 0.15);
      box(kit, PALETTE.brick, s + 0.2, 0.22, s * 0.75 + 0.2, 0, 2.2, 0);
    },
  },
  {
    id: 'factory',
    category: 'industry',
    description: 'scripts/build outputs: industrial shed with smokestack',
    names: [
      'scripts',
      'script',
      'tools',
      'tooling',
      'bin',
      'gen',
      'generated',
      'codegen',
      'out',
      'output',
    ],
    sizeRange: [5, 7],
    build: ({ kit, s }) => {
      const d = s * 0.65;
      box(kit, PALETTE.industrial, s, 1.8, d, 0, 0, 0);
      hipRoof(kit, PALETTE.rust, s, 0.6, d, 0, 1.8, 0);
      cyl(kit, PALETTE.brick, 0.28, 0.36, 3.2, 6, s * 0.32, 0, d * 0.2); // smokestack
      box(kit, PALETTE.roofSlate, 1.4, 1, 0.12, -s * 0.2, 0, -d / 2 - 0.06); // wide door
    },
  },
  {
    id: 'power-plant',
    category: 'industry',
    description: 'core/engine: cooling towers over a low block',
    names: ['core', 'engine', 'kernel', 'runtime', 'internals', 'internal'],
    sizeRange: [5, 7],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s, 1.4, s * 0.6, 0, 0, 0);
      cyl(kit, PALETTE.industrial, 0.55, 0.85, 2.8, 8, -s * 0.22, 0, 0); // cooling towers
      cyl(kit, PALETTE.industrial, 0.55, 0.85, 2.8, 8, s * 0.22, 0, 0);
      box(kit, PALETTE.roofSlate, 1.1, 0.9, 0.12, 0, 0, -s * 0.3 - 0.06);
    },
  },
  {
    id: 'water-tower',
    category: 'infra',
    description: 'small config/util folders: the Phase 1 water tower',
    names: [
      'config',
      'configs',
      'settings',
      'cfg',
      'utils',
      'util',
      'helpers',
      'shared',
      'common',
    ],
    maxFiles: 6,
    sizeRange: [2.5, 3.5],
    build: ({ kit, s }) => {
      const spread = s * 0.22;
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        cyl(kit, PALETTE.rust, 0.08, 0.08, 2.2, 5, sx * spread, 0, sz * spread);
      }
      cyl(kit, PALETTE.industrial, s * 0.32, s * 0.32, 1.4, 8, 0, 2.2, 0);
      cone(kit, PALETTE.roofRed, s * 0.36, 0.6, 8, 0, 3.6, 0);
    },
  },
  {
    id: 'warehouse',
    category: 'industry',
    description: 'data/fixtures/mocks: long low shed, loading docks',
    names: [
      'data',
      'fixtures',
      'fixture',
      'mocks',
      'mock',
      'seeds',
      'seed',
      'samples',
      'datasets',
      'dataset',
    ],
    sizeRange: [5, 7.5],
    build: ({ kit, s }) => {
      const d = s * 0.55;
      texBox(kit, 'dockDoors', s, 1.5, d, 0, 0, 0);
      box(kit, PALETTE.industrial, s + 0.3, 0.22, d + 0.3, 0, 1.5, 0);
      box(kit, PALETTE.concrete, s * 0.9, 0.3, 0.6, 0, 0, -d / 2 - 0.3); // dock platform
    },
  },
  {
    id: 'test-lab',
    category: 'industry',
    description: 'test/spec dirs: industrial lab, rooftop tanks and vents',
    names: ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress', 'testing'],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      const d = s * 0.7;
      texBox(kit, 'smallWindows', s, 2.2, d, 0, 0, 0);
      box(kit, PALETTE.concrete, s + 0.2, 0.22, d + 0.2, 0, 2.2, 0);
      cyl(kit, PALETTE.industrial, 0.4, 0.4, 0.9, 7, -s * 0.25, 2.42, 0); // tanks
      cyl(kit, PALETTE.industrial, 0.3, 0.3, 0.7, 7, s * 0.1, 2.42, d * 0.2);
      box(kit, PALETTE.rust, 0.3, 0.5, 0.3, s * 0.3, 2.42, -d * 0.2); // vent
      box(kit, PALETTE.rust, 0.24, 0.35, 0.24, s * 0.18, 2.42, -d * 0.3);
    },
  },
  {
    id: 'post-office',
    category: 'commerce',
    description: 'api/routes/controllers: mail-slot windows and a flag',
    names: [
      'api',
      'apis',
      'routes',
      'route',
      'endpoints',
      'endpoint',
      'controllers',
      'controller',
      'handlers',
      'rest',
      'graphql',
    ],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      const d = s * 0.7;
      texBox(kit, 'mailSlots', s, 2, d, 0, 0, 0);
      box(kit, PALETTE.civic, s + 0.3, 0.28, d + 0.3, 0, 2, 0);
      cyl(kit, PALETTE.industrial, 0.05, 0.05, 1.6, 5, s * 0.35, 2.28, d * 0.25); // flag pole
      box(kit, PALETTE.roofRed, 0.5, 0.3, 0.05, s * 0.35 + 0.28, 3.4, d * 0.25);
      frontSteps(kit, s * 0.55, -d / 2 - 0.35);
    },
  },
  {
    id: 'train-station',
    category: 'infra',
    description: 'jobs/workers/queues: arched glass roof hall',
    names: [
      'queue',
      'queues',
      'jobs',
      'job',
      'workers',
      'worker',
      'pipeline',
      'pipelines',
      'tasks',
      'schedulers',
      'scheduler',
      'cron',
    ],
    sizeRange: [5, 7],
    build: ({ kit, s }) => {
      const d = s * 0.6;
      texBox(kit, 'civicWindows', s, 1.8, d, 0, 0, 0);
      // Barrel-vault glass roof: a cylinder lying along x, half sunk into the
      // hall. cyl()'s base-y convention assumes a vertical axis, so pass
      // y = centerY - length/2 to land the rotated axis at roof height.
      const vaultLen = s * 0.96;
      cyl(kit, PALETTE.glassDark, d * 0.38, d * 0.38, vaultLen, 10, 0, 1.7 - vaultLen / 2, 0, {
        rz: Math.PI / 2,
      });
      box(kit, PALETTE.industrial, 1.4, 1.2, 0.12, 0, 0, -d / 2 - 0.06); // entry
    },
  },
  {
    id: 'radio-tower',
    category: 'infra',
    description: 'events/sockets/pubsub: slim lattice tower with antenna',
    names: [
      'events',
      'event',
      'sockets',
      'socket',
      'websocket',
      'websockets',
      'ws',
      'pubsub',
      'realtime',
      'signals',
      'broadcast',
    ],
    sizeRange: [2.5, 3.5],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s * 0.7, 0.9, s * 0.7, 0, 0, 0); // equipment hut
      box(kit, PALETTE.rust, 0.55, 1.6, 0.55, 0, 0.9, 0); // lattice tiers
      box(kit, PALETTE.rust, 0.4, 1.4, 0.4, 0, 2.5, 0);
      box(kit, PALETTE.rust, 0.26, 1.2, 0.26, 0, 3.9, 0);
      cyl(kit, PALETTE.industrial, 0.04, 0.04, 1.6, 4, 0, 5.1, 0); // antenna
      box(kit, PALETTE.industrial, 0.7, 0.05, 0.05, 0, 4.4, 0); // cross-arms
      box(kit, PALETTE.industrial, 0.05, 0.05, 0.7, 0, 3.2, 0);
      box(kit, PALETTE.roofRed, 0.12, 0.12, 0.12, 0, 6.7, 0); // beacon
    },
  },
  {
    id: 'park-fountain',
    category: 'parks',
    description: 'public/static/assets: green space with a fountain',
    names: [
      'public',
      'static',
      'assets',
      'asset',
      'images',
      'image',
      'img',
      'media',
      'fonts',
      'icons',
      'textures',
    ],
    sizeRange: [4.5, 6.5],
    build: ({ kit, s }) => {
      box(kit, PALETTE.grass, s, 0.06, s, 0, 0, 0); // lawn pad
      cyl(kit, PALETTE.concrete, 0.9, 1.0, 0.3, 8, 0, 0.06, 0); // basin
      cyl(kit, PALETTE.shore, 0.75, 0.75, 0.22, 8, 0, 0.2, 0); // water
      cyl(kit, PALETTE.concrete, 0.12, 0.16, 0.5, 6, 0, 0.3, 0);
      cone(kit, PALETTE.glassLight, 0.3, 0.5, 6, 0, 0.8, 0); // spray
      for (const [tx, tz] of [
        [-0.35, -0.3],
        [0.38, 0.28],
        [-0.28, 0.36],
        [0.3, -0.38],
      ] as const) {
        const x = tx * s;
        const z = tz * s;
        cyl(kit, PALETTE.trunk, 0.07, 0.07, 0.45, 5, x, 0.06, z);
        cone(kit, PALETTE.canopy, 0.45, 1.1, 6, x, 0.5, z);
      }
    },
  },
  {
    id: 'playground',
    category: 'parks',
    description: 'examples/demo/sandbox: park with play structures',
    names: ['examples', 'example', 'demo', 'demos', 'sandbox', 'playground', 'samples-app'],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      box(kit, PALETTE.grass, s, 0.06, s, 0, 0, 0);
      box(kit, PALETTE.beach, s * 0.35, 0.08, s * 0.3, s * 0.25, 0.06, s * 0.25); // sandbox
      // Play structure: two towers and a bridge.
      box(kit, PALETTE.roofRed, 0.5, 1.1, 0.5, -s * 0.22, 0.06, -s * 0.1);
      box(kit, PALETTE.glassLight, 0.5, 0.9, 0.5, s * 0.05, 0.06, -s * 0.1);
      box(kit, PALETTE.dash, 1.1, 0.1, 0.4, -s * 0.085, 0.96, -s * 0.1); // bridge
      box(kit, PALETTE.selection, 0.9, 0.08, 0.4, s * 0.28, 0.4, -s * 0.1, { rz: -0.5 }); // slide
      cone(kit, PALETTE.roofRed, 0.42, 0.5, 4, -s * 0.22, 1.16, -s * 0.1, { ry: Math.PI / 4 });
      cyl(kit, PALETTE.trunk, 0.07, 0.07, 0.45, 5, -s * 0.35, 0.06, s * 0.3);
      cone(kit, PALETTE.canopy, 0.45, 1.1, 6, -s * 0.35, 0.5, s * 0.3);
    },
  },
  {
    id: 'church',
    category: 'civic',
    description: 'LICENSE / governance files: chapel with a modest steeple',
    sizeRange: [3, 4],
    build: ({ kit, s }) => {
      const d = s * 1.3;
      box(kit, PALETTE.concrete, s, 1.6, d, 0, 0, 0);
      hipRoof(kit, PALETTE.roofSlate, s, 1.1, d, 0, 1.6, 0);
      box(kit, PALETTE.concrete, 0.7, 2.4, 0.7, 0, 0, -d / 2 + 0.35); // steeple base
      cone(kit, PALETTE.roofSlate, 0.55, 1.0, 4, 0, 2.4, -d / 2 + 0.35, { ry: Math.PI / 4 });
      box(kit, PALETTE.roofBrown, 0.5, 0.9, 0.1, 0, 0, -d / 2 - 0.05); // door
    },
  },
  {
    id: 'city-archive',
    category: 'civic',
    description: 'lockfiles: windowless stone records building',
    sizeRange: [3, 4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.industrial, s, 1.9, s * 0.8, 0, 0, 0);
      box(kit, PALETTE.concrete, s * 0.8, 0.7, s * 0.65, 0, 1.9, 0); // stepped top
      box(kit, PALETTE.roofSlate, 0.5, 0.9, 0.1, 0, 0, -s * 0.4 - 0.05); // slit door
      box(kit, PALETTE.concrete, s + 0.24, 0.2, s * 0.8 + 0.24, 0, 0, 0); // plinth
    },
  },
  {
    id: 'newsstand',
    category: 'commerce',
    description: 'README: kiosk by the plaza',
    sizeRange: [1.8, 2.4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.roofBrown, s, 1.2, s * 0.8, 0, 0, 0);
      texBox(kit, 'awning', s + 0.3, 0.08, 0.6, 0, 1.3, -s * 0.4 - 0.2, { rx: -0.25 });
      box(kit, PALETTE.dash, s * 0.7, 0.45, 0.06, 0, 0.5, -s * 0.4 - 0.03); // counter opening
    },
  },
  {
    id: 'clock-tower',
    category: 'civic',
    description: 'CHANGELOG: slim town-square clock tower',
    sizeRange: [1.6, 2.2],
    build: ({ kit, s }) => {
      box(kit, PALETTE.brick, s * 0.6, 3.6, s * 0.6, 0, 0, 0);
      cyl(kit, PALETTE.dash, 0.26, 0.26, 0.07, 8, 0, 3.0, -s * 0.3 - 0.04, { rx: Math.PI / 2 });
      cyl(kit, PALETTE.dash, 0.26, 0.26, 0.07, 8, s * 0.3 + 0.04, 3.0, 0, { rz: Math.PI / 2 });
      cone(kit, PALETTE.roofSlate, s * 0.5, 0.8, 4, 0, 3.6, 0, { ry: Math.PI / 4 });
      box(kit, PALETTE.selection, 0.1, 0.1, 0.1, 0, 4.5, 0);
    },
  },
  {
    id: 'customs-house',
    category: 'infra',
    description: '.github / CI workflows: checkpoint with barrier arm',
    names: ['.github', 'workflows', 'ci', '.circleci', '.gitlab', 'cicd', 'ci-cd', 'actions'],
    sizeRange: [3, 4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s * 0.6, 1.4, s * 0.6, -s * 0.2, 0, 0); // booth
      hipRoof(kit, PALETTE.roofRed, s * 0.7, 0.4, s * 0.7, -s * 0.2, 1.4, 0);
      box(kit, PALETTE.industrial, 0.14, 1.0, 0.14, s * 0.12, 0, -s * 0.2); // gate post
      box(kit, PALETTE.dash, s * 0.75, 0.09, 0.09, s * 0.42, 0.95, -s * 0.2, { rz: -0.35 }); // barrier arm
      box(kit, PALETTE.roofRed, 0.2, 0.1, 0.12, s * 0.2, 0.98, -s * 0.2);
    },
  },
  {
    id: 'apartment',
    category: 'residential',
    description: 'component dirs with many files: dense small windows',
    names: ['components', 'component', 'views', 'pages', 'widgets', 'ui', 'screens', 'layouts'],
    sizeRange: [3.5, 5],
    build: ({ kit, s, heightT }) => {
      const h = 3.5 + heightT * 4;
      texBox(kit, 'smallWindows', s, h, s * 0.8, 0, 0, 0);
      box(kit, PALETTE.concrete, s + 0.25, 0.3, s * 0.8 + 0.25, 0, h, 0); // parapet
      box(kit, PALETTE.industrial, 0.7, 0.6, 0.7, s * 0.2, h + 0.3, 0); // roof shed
      box(kit, PALETTE.concrete, 1.0, 0.9, 0.15, 0, 0, -s * 0.4 - 0.08); // entrance
    },
  },
  {
    id: 'office-tower',
    category: 'commerce',
    description: 'large source dirs: glass tower, floors scale with files',
    names: ['src', 'source', 'app', 'server', 'client', 'backend', 'frontend'],
    sizeRange: [4, 5],
    build: ({ kit, s, heightT }) => {
      const c = ARCHETYPE_CONFIG;
      const floors = Math.round(
        c.officeFloorsMin + heightT * (c.officeFloorsMax - c.officeFloorsMin),
      );
      const h = floors * c.officeFloorHeight;
      texBox(kit, 'glass', s, h, s, 0, 0, 0);
      box(kit, PALETTE.roofSlate, s + 0.2, 0.3, s + 0.2, 0, h, 0);
      box(kit, PALETTE.industrial, 0.6, 0.5, 0.6, s * 0.22, h + 0.3, s * 0.15);
      box(kit, PALETTE.concrete, 1.4, 1.0, 0.2, 0, 0, -s / 2 - 0.1); // lobby entrance
    },
  },
  // --- Downtown variety set: same size band as office-tower, chosen by path
  // hash among candidates so big codebases get a varied skyline, not one
  // tower copy-pasted (see matchCandidates).
  {
    id: 'tower-artdeco',
    category: 'commerce',
    description: 'large source dirs: stepped setback tower, era art-deco mass',
    sizeRange: [4, 5.5],
    build: ({ kit, s, heightT }) => {
      const h1 = 3.5 + heightT * 3.5;
      const h2 = h1 * 0.65;
      const h3 = h1 * 0.45;
      texBox(kit, 'smallWindows', s, h1, s * 0.85, 0, 0, 0);
      texBox(kit, 'smallWindows', s * 0.7, h2, s * 0.6, 0, h1, 0);
      texBox(kit, 'smallWindows', s * 0.42, h3, s * 0.38, 0, h1 + h2, 0);
      box(kit, PALETTE.civic, s * 0.2, 0.9, s * 0.2, 0, h1 + h2 + h3, 0); // crown block
      cone(kit, PALETTE.roofSlate, s * 0.14, 0.7, 4, 0, h1 + h2 + h3 + 0.9, 0, {
        ry: Math.PI / 4,
      });
      box(kit, PALETTE.concrete, 1.4, 1.0, 0.2, 0, 0, -s * 0.425 - 0.1);
    },
  },
  {
    id: 'tower-twin',
    category: 'commerce',
    description: 'large source dirs: twin glass slabs on a shared base',
    sizeRange: [4.5, 6],
    build: ({ kit, s, heightT }) => {
      const h = 5 + heightT * 5;
      box(kit, PALETTE.concrete, s, 1.2, s * 0.8, 0, 0, 0); // shared podium
      texBox(kit, 'glass', s * 0.34, h, s * 0.5, -s * 0.26, 1.2, 0);
      texBox(kit, 'glass', s * 0.34, h * 0.92, s * 0.5, s * 0.26, 1.2, 0);
      box(kit, PALETTE.roofSlate, s * 0.38, 0.25, s * 0.54, -s * 0.26, 1.2 + h, 0);
      box(kit, PALETTE.roofSlate, s * 0.38, 0.25, s * 0.54, s * 0.26, 1.2 + h * 0.92, 0);
      box(kit, PALETTE.dash, s * 0.18, 0.25, 0.5, 0, h * 0.55, 0); // skybridge
    },
  },
  {
    id: 'tower-cylinder',
    category: 'commerce',
    description: 'large source dirs: round glass tower with a drum cap',
    sizeRange: [4, 5],
    build: ({ kit, s, heightT }) => {
      const h = 5.5 + heightT * 5;
      const r = s * 0.42;
      cyl(kit, PALETTE.glassDark, r, r, h, 10, 0, 0, 0);
      cyl(kit, PALETTE.glassLight, r * 0.98, r * 0.98, h * 0.16, 10, 0, h * 0.42, 0); // lit band
      cyl(kit, PALETTE.concrete, r * 0.7, r * 0.85, 0.8, 10, 0, h, 0); // drum cap
      cyl(kit, PALETTE.concrete, r * 1.15, r * 1.15, 0.9, 10, 0, 0, 0); // lobby ring
    },
  },
  {
    id: 'tower-spire',
    category: 'commerce',
    description: 'large source dirs: tower with a pyramidal crown and spire',
    sizeRange: [4, 5],
    build: ({ kit, s, heightT }) => {
      const h = 5 + heightT * 5.5;
      texBox(kit, 'glass', s * 0.85, h, s * 0.85, 0, 0, 0);
      hipRoof(kit, PALETTE.roofRed, s * 0.9, 1.6, s * 0.9, 0, h, 0); // crown
      cyl(kit, PALETTE.industrial, 0.05, 0.05, 1.8, 4, 0, h + 1.6, 0); // spire
      box(kit, PALETTE.selection, 0.14, 0.14, 0.14, 0, h + 3.3, 0); // beacon
      box(kit, PALETTE.concrete, 1.3, 1.0, 0.2, 0, 0, -s * 0.425 - 0.1);
    },
  },
  {
    id: 'midrise-slab',
    category: 'commerce',
    description: 'large source dirs: wide mid-rise slab, banded windows',
    sizeRange: [5, 7],
    build: ({ kit, s, heightT }) => {
      const h = 3 + heightT * 2.2;
      texBox(kit, 'civicWindows', s, h, s * 0.5, 0, 0, 0);
      box(kit, PALETTE.concrete, s + 0.3, 0.3, s * 0.5 + 0.3, 0, h, 0);
      box(kit, PALETTE.industrial, 1.0, 0.6, 0.8, -s * 0.3, h + 0.3, 0); // roof plant
      box(kit, PALETTE.industrial, 0.7, 0.45, 0.7, s * 0.25, h + 0.3, 0);
      box(kit, PALETTE.concrete, 1.6, 1.0, 0.25, 0, 0, -s * 0.25 - 0.12); // entrance
    },
  },
  // --- Skyline diversity set (SimCity-2000-style civic texture). Most have
  // honest semantic mappings; the rest live in AMENITY_SET and are placed by
  // the population-derived amenity rule in layout.ts.
  {
    id: 'stadium',
    category: 'civic',
    description: 'benchmarks/perf: oval arena with floodlights',
    names: ['benchmarks', 'benchmark', 'bench', 'perf', 'performance'],
    sizeRange: [6, 8],
    build: ({ kit, s }) => {
      cyl(kit, PALETTE.concrete, s * 0.42, s * 0.46, 1.6, 12, 0, 0, 0, { sx: 1.35 });
      cyl(kit, PALETTE.industrial, s * 0.4, s * 0.42, 0.4, 12, 0, 1.6, 0, { sx: 1.35 }); // rim
      cyl(kit, PALETTE.grass, s * 0.3, s * 0.3, 1.5, 12, 0, 0.25, 0, { sx: 1.35 }); // pitch
      for (const [px, pz] of [
        [0.5, 0.35],
        [-0.5, 0.35],
        [0.5, -0.35],
        [-0.5, -0.35],
      ] as const) {
        box(kit, PALETTE.industrial, 0.1, 2.6, 0.1, px * s, 0, pz * s);
        box(kit, PALETTE.selection, 0.34, 0.16, 0.1, px * s, 2.6, pz * s); // floodlight
      }
      box(kit, PALETTE.roofRed, 1.4, 1.0, 0.16, 0, 0, -s * 0.46, { sx: 1 }); // gate
    },
  },
  {
    id: 'museum',
    category: 'civic',
    description: 'legacy/deprecated: museum with a glass pyramid court',
    names: ['legacy', 'deprecated', 'old', 'attic', 'vintage', 'archive-old'],
    sizeRange: [5, 6.5],
    build: ({ kit, s }) => {
      const d = s * 0.6;
      texBox(kit, 'civicWindows', s, 1.9, d, 0, 0, 0);
      box(kit, PALETTE.civic, s + 0.4, 0.3, d + 0.4, 0, 1.9, 0);
      cone(kit, PALETTE.glassLight, 1.1, 1.2, 4, 0, 0.06, -d / 2 - 1.2, { ry: Math.PI / 4 }); // pyramid
      box(kit, PALETTE.roofRed, 0.35, 1.1, 0.06, -s * 0.3, 0.7, -d / 2 - 0.03); // banners
      box(kit, PALETTE.glassDark, 0.35, 1.1, 0.06, s * 0.3, 0.7, -d / 2 - 0.03);
      frontSteps(kit, s * 0.6, -d / 2 - 0.5);
    },
  },
  {
    id: 'hotel',
    category: 'commerce',
    description: 'cache/tmp/sessions: tall hotel, guests never stay long',
    names: ['cache', '.cache', 'tmp', 'temp', 'sessions', 'session', 'scratch'],
    sizeRange: [3.5, 5],
    build: ({ kit, s, heightT }) => {
      const h = 4 + heightT * 3.5;
      texBox(kit, 'smallWindows', s, h, s * 0.7, 0, 0, 0);
      box(kit, PALETTE.civic, s + 0.2, 0.28, s * 0.7 + 0.2, 0, h, 0);
      box(kit, PALETTE.selection, s * 0.5, 0.45, 0.12, 0, h + 0.28, 0); // rooftop sign
      box(kit, PALETTE.roofRed, 1.6, 0.14, 1.0, 0, 1.1, -s * 0.35 - 0.5); // canopy
      box(kit, PALETTE.industrial, 0.1, 1.1, 0.1, -0.6, 0, -s * 0.35 - 0.9);
      box(kit, PALETTE.industrial, 0.1, 1.1, 0.1, 0.6, 0, -s * 0.35 - 0.9);
    },
  },
  {
    id: 'motel',
    category: 'commerce',
    description: 'amenity: L-shaped roadside motel with a tall sign',
    sizeRange: [3.5, 4.5],
    build: ({ kit, s }) => {
      box(kit, PALETTE.civic, s, 1.1, s * 0.4, 0, 0, s * 0.2);
      box(kit, PALETTE.civic, s * 0.4, 1.1, s * 0.6, -s * 0.3, 0, -s * 0.15);
      box(kit, PALETTE.roofRed, s + 0.2, 0.16, s * 0.4 + 0.2, 0, 1.1, s * 0.2);
      box(kit, PALETTE.roofRed, s * 0.4 + 0.2, 0.16, s * 0.6 + 0.2, -s * 0.3, 1.1, -s * 0.15);
      cyl(kit, PALETTE.industrial, 0.06, 0.06, 2.2, 5, s * 0.35, 0, -s * 0.3); // sign pole
      box(kit, PALETTE.selection, 0.7, 0.5, 0.1, s * 0.35, 2.2, -s * 0.3);
    },
  },
  {
    id: 'department-store',
    category: 'commerce',
    description: 'store/shop/catalog: two-floor department store',
    names: ['store', 'stores', 'shop', 'shops', 'products', 'catalog', 'cart', 'checkout'],
    sizeRange: [4.5, 6.5],
    build: ({ kit, s }) => {
      const d = s * 0.7;
      box(kit, PALETTE.concrete, s, 2.4, d, 0, 0, 0);
      texBox(kit, 'awning', s + 0.2, 0.1, 0.7, 0, 1.15, -d / 2 - 0.3, { rx: -0.2 });
      box(kit, PALETTE.glassDark, s * 0.8, 0.9, 0.08, 0, 0.1, -d / 2 - 0.04); // display glass
      box(kit, PALETTE.roofRed, s * 0.4, 0.6, 0.14, 0, 2.4, 0); // roof sign block
      box(kit, PALETTE.industrial, s + 0.3, 0.2, d + 0.3, 0, 2.4, 0);
    },
  },
  {
    id: 'casino',
    category: 'commerce',
    description: 'fuzz/random/chaos: the house always wins eventually',
    names: ['fuzz', 'fuzzing', 'random', 'chaos', 'montecarlo', 'lottery'],
    sizeRange: [4, 5.5],
    build: ({ kit, s, heightT }) => {
      const h = 2.6 + heightT * 1.6;
      texBox(kit, 'smallWindows', s, h, s * 0.7, 0, 0, 0);
      box(kit, PALETTE.selection, s + 0.24, 0.22, s * 0.7 + 0.24, 0, h, 0); // gold trim
      box(kit, PALETTE.selection, s + 0.16, 0.16, s * 0.7 + 0.16, 0, 0, 0);
      dome(kit, PALETTE.selection, s * 0.16, 0, h + 0.22, 0);
      box(kit, PALETTE.roofRed, s * 0.6, 0.8, 0.12, 0, 0.5, -s * 0.35 - 0.06); // marquee wall
      box(kit, PALETTE.dash, s * 0.5, 0.14, 0.16, 0, 1.35, -s * 0.35 - 0.08);
    },
  },
  {
    id: 'theater',
    category: 'commerce',
    description: 'themes/styles/templates: theater with a marquee',
    names: [
      'themes',
      'theme',
      'styles',
      'style',
      'templates',
      'template',
      'skins',
      'layouts-old',
    ],
    sizeRange: [3.5, 5],
    build: ({ kit, s }) => {
      const d = s * 0.8;
      box(kit, PALETTE.brick, s, 2.2, d, 0, 0, 0.3);
      box(kit, PALETTE.civic, s * 0.9, 2.8, 0.3, 0, 0, -d / 2 + 0.15); // facade
      texBox(kit, 'awning', s * 0.7, 0.1, 0.8, 0, 1.3, -d / 2 - 0.4);
      box(kit, PALETTE.roofRed, 0.4, 1.6, 0.14, 0, 2.8, -d / 2 + 0.1, { rz: 0 }); // vertical sign
      box(kit, PALETTE.selection, 0.44, 0.2, 0.16, 0, 2.7, -d / 2 + 0.1);
    },
  },
  {
    id: 'observation-tower',
    category: 'infra',
    description: 'analytics/metrics/insights: observation deck over the city',
    names: ['analytics', 'metrics', 'insights', 'stats', 'dashboards', 'dashboard', 'reports'],
    sizeRange: [2.5, 3.5],
    build: ({ kit, s, heightT }) => {
      const h = 4.5 + heightT * 2;
      cyl(kit, PALETTE.concrete, 0.55, 0.8, 0.5, 8, 0, 0, 0); // base
      cyl(kit, PALETTE.concrete, 0.16, 0.3, h, 8, 0, 0.5, 0); // shaft
      cyl(kit, PALETTE.glassDark, s * 0.42, s * 0.32, 0.7, 10, 0, h + 0.5, 0); // deck
      cyl(kit, PALETTE.concrete, s * 0.3, s * 0.42, 0.25, 10, 0, h + 1.2, 0);
      cyl(kit, PALETTE.industrial, 0.04, 0.04, 1.1, 4, 0, h + 1.45, 0); // antenna
    },
  },
  {
    id: 'grain-silo',
    category: 'industry',
    description: 'db/sql/storage: grain silos — where the data is kept',
    names: ['db', 'database', 'databases', 'sql', 'storage', 'redis', 'mongo', 'postgres'],
    sizeRange: [3.5, 5],
    build: ({ kit, s }) => {
      cyl(kit, PALETTE.concrete, 0.55, 0.55, 3.2, 8, -s * 0.28, 0, 0);
      cyl(kit, PALETTE.concrete, 0.55, 0.55, 2.7, 8, 0, 0, s * 0.1);
      cyl(kit, PALETTE.concrete, 0.55, 0.55, 2.9, 8, s * 0.28, 0, -s * 0.05);
      cone(kit, PALETTE.industrial, 0.6, 0.5, 8, -s * 0.28, 3.2, 0);
      cone(kit, PALETTE.industrial, 0.6, 0.5, 8, 0, 2.7, s * 0.1);
      cone(kit, PALETTE.industrial, 0.6, 0.5, 8, s * 0.28, 2.9, -s * 0.05);
      box(kit, PALETTE.rust, s * 0.7, 1.0, s * 0.4, 0, 0, -s * 0.32); // intake shed
      box(kit, PALETTE.industrial, 0.1, 2.4, 0.1, s * 0.05, 0, s * 0.35, { rz: 0.5 }); // conveyor
    },
  },
  {
    id: 'tank-farm',
    category: 'industry',
    description: 'migrations/etl: tank farm with pipe runs',
    names: ['migrations', 'migration', 'etl', 'ingest', 'ingestion', 'dataflow', 'streams'],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      cyl(kit, PALETTE.industrial, s * 0.2, s * 0.2, 0.6, 10, -s * 0.25, 0, -s * 0.1);
      dome(kit, PALETTE.industrial, s * 0.2, -s * 0.25, 0.6, -s * 0.1); // sphere tank 1
      cyl(kit, PALETTE.industrial, s * 0.16, s * 0.16, 0.5, 10, s * 0.22, 0, s * 0.18);
      dome(kit, PALETTE.industrial, s * 0.16, s * 0.22, 0.5, s * 0.18); // sphere tank 2
      cyl(kit, PALETTE.rust, s * 0.18, s * 0.18, 1.8, 10, s * 0.25, 0, -s * 0.22); // tall tank
      box(kit, PALETTE.rust, s * 0.7, 0.1, 0.1, 0, 0.5, 0); // pipes
      box(kit, PALETTE.rust, 0.1, 0.1, s * 0.5, -s * 0.05, 0.5, 0);
      box(kit, PALETTE.concrete, s * 0.35, 0.8, s * 0.25, 0, 0, s * 0.32); // pump house
      box(kit, PALETTE.roofSlate, s * 0.38, 0.12, s * 0.28, 0, 0.8, s * 0.32);
    },
  },
  {
    id: 'container-port',
    category: 'industry',
    description: 'docker/k8s/deploy: container yard with a gantry crane',
    names: [
      'docker',
      'containers',
      'container',
      'k8s',
      'kubernetes',
      'deploy',
      'deployment',
      'infra',
      'terraform',
      'helm',
    ],
    sizeRange: [5, 7],
    build: ({ kit, s }) => {
      // Container stacks (era primaries, staggered).
      const colors = [PALETTE.roofRed, PALETTE.glassDark, PALETTE.rust, PALETTE.grass];
      for (let i = 0; i < 4; i++) {
        const color = colors[i % colors.length] ?? PALETTE.rust;
        box(
          kit,
          color,
          1.1,
          0.5,
          0.55,
          -s * 0.3 + i * 0.02 + (i % 2) * 0.6,
          i < 2 ? 0 : 0.5,
          -s * 0.15 + i * 0.35,
        );
      }
      box(kit, PALETTE.roofRed, 1.1, 0.5, 0.55, s * 0.2, 0, s * 0.2);
      box(kit, PALETTE.glassDark, 1.1, 0.5, 0.55, s * 0.2, 0.5, s * 0.2);
      // Gantry crane straddling the yard.
      box(kit, PALETTE.selection, 0.14, 2.2, 0.14, -s * 0.35, 0, 0);
      box(kit, PALETTE.selection, 0.14, 2.2, 0.14, s * 0.35, 0, 0);
      box(kit, PALETTE.selection, s * 0.78, 0.16, 0.16, 0, 2.2, 0); // beam
      box(kit, PALETTE.industrial, 0.2, 0.5, 0.2, s * 0.1, 1.7, 0); // trolley
      box(kit, PALETTE.concrete, s * 0.35, 0.9, s * 0.3, s * 0.3, 0, -s * 0.28); // office
    },
  },
  {
    id: 'gas-station',
    category: 'commerce',
    description: 'amenity: canopy, two pumps, kiosk',
    sizeRange: [3, 4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s * 0.5, 1.1, s * 0.4, s * 0.22, 0, s * 0.22); // kiosk
      box(kit, PALETTE.roofRed, s * 0.52, 0.14, s * 0.42, s * 0.22, 1.1, s * 0.22);
      box(kit, PALETTE.dash, s * 0.8, 0.14, s * 0.5, -s * 0.1, 1.5, -s * 0.14); // canopy
      box(kit, PALETTE.industrial, 0.08, 1.5, 0.08, -s * 0.35, 0, -s * 0.14);
      box(kit, PALETTE.industrial, 0.08, 1.5, 0.08, s * 0.14, 0, -s * 0.14);
      box(kit, PALETTE.roofRed, 0.22, 0.5, 0.18, -s * 0.18, 0, -s * 0.14); // pumps
      box(kit, PALETTE.roofRed, 0.22, 0.5, 0.18, 0.0, 0, -s * 0.14);
    },
  },
  {
    id: 'parking-garage',
    category: 'infra',
    description: 'amenity: open-deck parking structure',
    sizeRange: [4, 5.5],
    build: ({ kit, s }) => {
      const d = s * 0.7;
      for (let level = 0; level < 3; level++) {
        box(kit, PALETTE.concrete, s, 0.18, d, 0, level * 0.9, 0); // deck slabs
        if (level < 3) {
          for (const cx of [-0.42, -0.14, 0.14, 0.42]) {
            box(
              kit,
              PALETTE.industrial,
              0.14,
              0.9,
              0.14,
              cx * s,
              level * 0.9 + 0.18,
              -d * 0.42,
            );
            box(kit, PALETTE.industrial, 0.14, 0.9, 0.14, cx * s, level * 0.9 + 0.18, d * 0.42);
          }
        }
      }
      box(kit, PALETTE.concrete, s, 0.18, d, 0, 2.7, 0);
      box(kit, PALETTE.industrial, s, 0.3, 0.08, 0, 2.88, -d / 2 + 0.04); // parapet
      box(kit, PALETTE.selection, 0.5, 0.34, 0.08, 0, 0.4, -d / 2 - 0.04); // entry sign
    },
  },
  {
    id: 'row-block',
    category: 'residential',
    description: 'amenity: three attached brick rowhouses',
    sizeRange: [3.5, 4.5],
    build: ({ kit, s }) => {
      const w = s / 3;
      texBox(kit, 'brickWindows', w, 2.0, s * 0.7, -w, 0, 0);
      texBox(kit, 'brickWindows', w, 2.3, s * 0.7, 0, 0, 0);
      texBox(kit, 'brickWindows', w, 1.9, s * 0.7, w, 0, 0);
      box(kit, PALETTE.roofBrown, w + 0.1, 0.16, s * 0.7 + 0.1, -w, 2.0, 0);
      box(kit, PALETTE.roofSlate, w + 0.1, 0.16, s * 0.7 + 0.1, 0, 2.3, 0);
      box(kit, PALETTE.roofRed, w + 0.1, 0.16, s * 0.7 + 0.1, w, 1.9, 0);
      for (const cx of [-1, 0, 1]) {
        box(kit, PALETTE.concrete, 0.5, 0.22, 0.4, cx * w, 0, -s * 0.35 - 0.2); // stoops
      }
    },
  },
  {
    id: 'condo-slab',
    category: 'residential',
    description: 'mid-size dirs: condo slab with balcony ledges',
    sizeRange: [4, 5.5],
    build: ({ kit, s, heightT }) => {
      const h = 3.4 + heightT * 2.4;
      texBox(kit, 'smallWindows', s, h, s * 0.55, 0, 0, 0);
      const floors = Math.max(2, Math.round(h / 0.9));
      for (let f = 1; f < floors; f++) {
        box(kit, PALETTE.concrete, s + 0.16, 0.08, 0.3, 0, f * (h / floors), -s * 0.275 - 0.15);
      }
      box(kit, PALETTE.concrete, s + 0.2, 0.25, s * 0.55 + 0.2, 0, h, 0);
      box(kit, PALETTE.roofBrown, 1.0, 0.9, 0.16, 0, 0, -s * 0.275 - 0.08);
    },
  },
  {
    id: 'diner',
    category: 'commerce',
    description: 'amenity: chrome roadside diner',
    sizeRange: [2.5, 3.2],
    build: ({ kit, s }) => {
      box(kit, PALETTE.industrial, s, 0.9, s * 0.55, 0, 0, 0);
      box(kit, PALETTE.roofRed, s, 0.2, s * 0.55, 0, 0.9, 0); // red band
      const roofLen = s * 0.98;
      cyl(kit, PALETTE.dash, s * 0.26, s * 0.26, roofLen, 8, 0, 1.1 - roofLen / 2, 0, {
        rz: Math.PI / 2,
        sx: 1, // (length axis is x after rotation)
      });
      box(kit, PALETTE.glassLight, s * 0.8, 0.4, 0.06, 0, 0.3, -s * 0.275 - 0.03); // window band
      cyl(kit, PALETTE.industrial, 0.05, 0.05, 1.9, 5, s * 0.42, 0, -s * 0.2);
      box(kit, PALETTE.selection, 0.6, 0.4, 0.08, s * 0.42, 1.9, -s * 0.2); // sign
    },
  },
  {
    id: 'wind-farm',
    category: 'parks',
    description: 'amenity: two wind turbines on a service pad',
    sizeRange: [4, 5],
    build: ({ kit, s }) => {
      box(kit, PALETTE.grass, s, 0.06, s, 0, 0, 0);
      for (const [tx, tz, h] of [
        [-0.22, 0.1, 3.2],
        [0.25, -0.18, 2.7],
      ] as const) {
        const x = tx * s;
        const z = tz * s;
        cyl(kit, PALETTE.concrete, 0.07, 0.13, h, 6, x, 0.06, z); // mast
        for (let b = 0; b < 3; b++) {
          box(kit, PALETTE.dash, 0.09, 1.0, 0.04, x, h - 0.4, z - 0.1, {
            rz: (b * Math.PI * 2) / 3 + 0.5,
          });
        }
        box(kit, PALETTE.concrete, 0.18, 0.18, 0.3, x, h - 0.5, z);
      }
      box(kit, PALETTE.concrete, s * 0.3, 0.7, s * 0.22, s * 0.3, 0.06, s * 0.32); // service hut
    },
  },
  {
    id: 'water-treatment',
    category: 'industry',
    description: 'filters/transforms: round settling basins and a pump hut',
    names: ['filters', 'filter', 'transforms', 'transform', 'sanitize', 'cleaners'],
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      cyl(kit, PALETTE.concrete, s * 0.24, s * 0.26, 0.5, 10, -s * 0.2, 0, -s * 0.1);
      cyl(kit, PALETTE.shore, s * 0.2, s * 0.2, 0.45, 10, -s * 0.2, 0.12, -s * 0.1); // water
      cyl(kit, PALETTE.concrete, s * 0.2, s * 0.22, 0.5, 10, s * 0.24, 0, s * 0.16);
      cyl(kit, PALETTE.shore, s * 0.16, s * 0.16, 0.45, 10, s * 0.24, 0.12, s * 0.16);
      box(kit, PALETTE.rust, s * 0.5, 0.09, 0.09, 0, 0.6, 0); // pipe bridge
      box(kit, PALETTE.concrete, s * 0.3, 1.0, s * 0.24, s * 0.28, 0, -s * 0.3); // pump hut
      box(kit, PALETTE.roofSlate, s * 0.33, 0.12, s * 0.27, s * 0.28, 1.0, -s * 0.3);
    },
  },
  {
    id: 'lighthouse',
    category: 'infra',
    description: 'root index.* file: the city entry point, guiding ships in',
    sizeRange: [2, 2.6],
    build: ({ kit, s }) => {
      cyl(kit, PALETTE.dash, s * 0.22, s * 0.34, 1.4, 8, 0, 0, 0); // white band
      cyl(kit, PALETTE.roofRed, s * 0.18, s * 0.22, 1.2, 8, 0, 1.4, 0); // red band
      cyl(kit, PALETTE.dash, s * 0.16, s * 0.18, 1.0, 8, 0, 2.6, 0);
      cyl(kit, PALETTE.glassLight, s * 0.14, s * 0.14, 0.5, 8, 0, 3.6, 0); // lantern
      cone(kit, PALETTE.roofRed, s * 0.2, 0.5, 8, 0, 4.1, 0);
      box(kit, PALETTE.concrete, s * 0.5, 0.5, s * 0.4, s * 0.3, 0, s * 0.2); // keeper hut
      box(kit, PALETTE.roofRed, s * 0.55, 0.12, s * 0.45, s * 0.3, 0.5, s * 0.2);
    },
  },
  {
    id: 'cathedral',
    category: 'civic',
    description: 'amenity: twin-tower cathedral with rose window',
    sizeRange: [4.5, 6],
    build: ({ kit, s }) => {
      const d = s * 1.2;
      box(kit, PALETTE.concrete, s * 0.7, 2.4, d, 0, 0, 0); // nave
      hipRoof(kit, PALETTE.roofSlate, s * 0.75, 1.2, d, 0, 2.4, 0);
      box(kit, PALETTE.concrete, s, 2.0, s * 0.35, 0, 0, 0.1); // transept
      hipRoof(kit, PALETTE.roofSlate, s, 1.0, s * 0.4, 0, 2.0, 0.1);
      for (const tx of [-1, 1]) {
        box(kit, PALETTE.concrete, 0.75, 3.4, 0.75, tx * s * 0.28, 0, -d / 2 + 0.4);
        cone(kit, PALETTE.roofSlate, 0.6, 1.4, 4, tx * s * 0.28, 3.4, -d / 2 + 0.4, {
          ry: Math.PI / 4,
        });
      }
      cyl(kit, PALETTE.glassDark, 0.4, 0.4, 0.08, 10, 0, 1.9, -d / 2 - 0.04, {
        rx: Math.PI / 2,
      }); // rose window
      box(kit, PALETTE.roofBrown, 0.6, 1.1, 0.1, 0, 0, -d / 2 - 0.05);
    },
  },
  // --- Language-specific homes (extension fallback tier) -----------------------
  {
    id: 'house-js',
    category: 'homes',
    description: 'JS/TS rowhouse: two floors, parapet, stoop',
    sizeRange: [2.2, 3],
    build: ({ kit, s }) => {
      texBox(kit, 'brickWindows', s, 2.1, s * 1.2, 0, 0, 0);
      box(kit, PALETTE.brick, s + 0.2, 0.25, s * 1.2 + 0.1, 0, 2.1, 0); // parapet
      frontSteps(kit, s * 0.45, -s * 0.6 - 0.3);
      box(kit, PALETTE.roofBrown, 0.55, 0.85, 0.08, 0, 0.28, -s * 0.6 - 0.04);
    },
  },
  {
    id: 'house-python',
    category: 'homes',
    description: 'Python bungalow: low, wide roof, porch posts',
    sizeRange: [2.4, 3.2],
    build: ({ kit, s }) => {
      box(kit, PALETTE.civic, s, 1.1, s * 0.9, 0, 0, 0);
      hipRoof(kit, PALETTE.roofBrown, s * 1.25, 0.7, s * 1.15, 0, 1.1, 0);
      box(kit, PALETTE.concrete, s * 0.8, 0.1, 0.5, 0, 0, -s * 0.45 - 0.25); // porch
      box(kit, PALETTE.trunk, 0.09, 1.1, 0.09, -s * 0.3, 0.1, -s * 0.45 - 0.4);
      box(kit, PALETTE.trunk, 0.09, 1.1, 0.09, s * 0.3, 0.1, -s * 0.45 - 0.4);
    },
  },
  {
    id: 'house-go',
    category: 'homes',
    description: 'Go duplex: two attached volumes, offset heights',
    sizeRange: [2.6, 3.4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.glassDark, s * 0.55, 1.7, s * 0.9, -s * 0.225, 0, 0);
      box(kit, PALETTE.concrete, s * 0.55, 1.3, s * 0.9, s * 0.225, 0, 0);
      box(kit, PALETTE.roofSlate, s * 0.6, 0.16, s * 0.95, -s * 0.225, 1.7, 0);
      box(kit, PALETTE.roofSlate, s * 0.6, 0.16, s * 0.95, s * 0.225, 1.3, 0);
      box(kit, PALETTE.roofBrown, 0.5, 0.8, 0.08, -s * 0.225, 0, -s * 0.45 - 0.04);
      box(kit, PALETTE.roofBrown, 0.5, 0.8, 0.08, s * 0.225, 0, -s * 0.45 - 0.04);
    },
  },
  {
    id: 'house-rust',
    category: 'homes',
    description: 'Rust cottage: steep roof, chimney',
    sizeRange: [2.2, 3],
    build: ({ kit, s }) => {
      box(kit, PALETTE.rust, s, 1.2, s * 0.85, 0, 0, 0);
      hipRoof(kit, PALETTE.roofBrown, s * 1.1, 1.2, s * 0.95, 0, 1.2, 0);
      box(kit, PALETTE.brick, 0.3, 1.0, 0.3, s * 0.3, 1.5, s * 0.15); // chimney
      box(kit, PALETTE.roofBrown, 0.5, 0.8, 0.08, 0, 0, -s * 0.425 - 0.04);
    },
  },
  {
    id: 'house-java',
    category: 'homes',
    description: 'Java/Kotlin brownstone: three floors, cornice, stoop',
    sizeRange: [2.4, 3.2],
    build: ({ kit, s }) => {
      texBox(kit, 'brickWindows', s, 2.9, s * 1.1, 0, 0, 0);
      box(kit, PALETTE.roofBrown, s + 0.3, 0.22, s * 1.1 + 0.2, 0, 2.9, 0); // cornice
      frontSteps(kit, s * 0.5, -s * 0.55 - 0.35);
      box(kit, PALETTE.roofSlate, 0.55, 0.9, 0.08, 0, 0.28, -s * 0.55 - 0.04);
    },
  },
  {
    id: 'house-c',
    category: 'homes',
    description: 'C/C++ workshop: sawtooth roof, wide door',
    sizeRange: [2.6, 3.6],
    build: ({ kit, s }) => {
      box(kit, PALETTE.industrial, s, 1.3, s * 0.9, 0, 0, 0);
      box(kit, PALETTE.roofSlate, s * 0.52, 0.08, s * 0.95, -s * 0.24, 1.62, 0, { rz: 0.45 }); // sawtooth
      box(kit, PALETTE.roofSlate, s * 0.52, 0.08, s * 0.95, s * 0.26, 1.62, 0, { rz: 0.45 });
      box(kit, PALETTE.roofBrown, s * 0.45, 0.95, 0.1, 0, 0, -s * 0.45 - 0.05); // wide door
    },
  },
  {
    id: 'house-ruby',
    category: 'homes',
    description: 'Ruby cabin: low timber volume, deep roof',
    sizeRange: [2.2, 2.8],
    build: ({ kit, s }) => {
      box(kit, PALETTE.roofBrown, s, 1.0, s * 0.85, 0, 0, 0);
      hipRoof(kit, PALETTE.roofRed, s * 1.15, 0.8, s * 1.0, 0, 1.0, 0);
      box(kit, PALETTE.trunk, 0.09, 0.9, 0.09, -s * 0.32, 0, -s * 0.425 - 0.25);
      box(kit, PALETTE.trunk, 0.09, 0.9, 0.09, s * 0.32, 0, -s * 0.425 - 0.25);
      box(kit, PALETTE.beach, 0.45, 0.75, 0.08, 0, 0, -s * 0.425 - 0.04);
    },
  },
  {
    id: 'house-shell',
    category: 'homes',
    description: 'Shell/config utility shed: single-slope roof',
    sizeRange: [1.8, 2.4],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s, 1.0, s * 0.8, 0, 0, 0);
      box(kit, PALETTE.industrial, s * 1.1, 0.08, s * 0.95, 0, 1.15, 0, { rz: 0.22 }); // lean-to roof
      box(kit, PALETTE.roofSlate, 0.5, 0.8, 0.08, 0, 0, -s * 0.4 - 0.04);
    },
  },
  {
    id: 'house-generic',
    category: 'homes',
    description: 'Everything else: plain gabled house',
    sizeRange: [2.2, 2.8],
    build: ({ kit, s }) => {
      box(kit, PALETTE.concrete, s, 1.2, s * 0.9, 0, 0, 0);
      hipRoof(kit, PALETTE.roofSlate, s * 1.05, 0.8, s * 0.95, 0, 1.2, 0);
      box(kit, PALETTE.roofBrown, 0.5, 0.8, 0.08, 0, 0, -s * 0.45 - 0.04);
    },
  },
] as const;

const byId = new Map<string, ArchetypeSpec>(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeById(id: string): ArchetypeSpec {
  const spec = byId.get(id);
  if (!spec) throw new Error(`Unknown archetype: ${id}`);
  return spec;
}

// --- Matching -------------------------------------------------------------------
// Precedence (documented contract, revised for Phase 2A anti-repetition):
// a directory gets an ORDERED CANDIDATE LIST rather than a single match —
// exact directory names first, then path-role patterns, then size-tier
// alternates, then dominant-extension house, then the generic house. The
// primary archetype is candidates[0], EXCEPT within the size tier: large
// directories with no semantic match draw from the downtown/apartment
// variety sets, ordered deterministically by path hash, so same-repo
// directories with similar stats don't all collapse onto one silhouette.
// The remaining candidates feed layout.ts's per-district diversify pass,
// which swaps over-repeated archetypes to their next-best candidate.
// Still fully deterministic for a given tree: hash inputs are paths only.

/** Large source dirs (office threshold) draw from this skyline set. */
const DOWNTOWN_SET: readonly string[] = [
  'office-tower',
  'tower-artdeco',
  'tower-twin',
  'tower-cylinder',
  'tower-spire',
  'midrise-slab',
  'hotel',
];

/** Mid-size dirs (apartment threshold) draw from this set. */
const MIDTOWN_SET: readonly string[] = [
  'apartment',
  'midrise-slab',
  'tower-artdeco',
  'condo-slab',
  'parking-garage',
];

/**
 * Pure-diversity amenities: no directory mapping. layout.ts sprinkles a few
 * onto leftover ring space, count derived from the true population (file
 * count) only — honest data, generic signs, never presented as directories.
 */
export const AMENITY_SET: readonly string[] = [
  'diner',
  'gas-station',
  'motel',
  'parking-garage',
  'cathedral',
  'wind-farm',
  'row-block',
  'theater',
  'museum',
  'water-treatment',
  'park-fountain',
  'playground',
];

/** Friendly sign text for amenity buildings. */
export const AMENITY_SIGNS: Readonly<Record<string, string>> = {
  diner: 'diner',
  'gas-station': 'gas & go',
  motel: 'motel',
  'parking-garage': 'parking',
  cathedral: 'cathedral',
  'wind-farm': 'wind farm',
  'row-block': 'rowhouses',
  theater: 'theater',
  museum: 'museum',
  'water-treatment': 'waterworks',
  'park-fountain': 'city park',
  playground: 'playground',
};

const EXTENSION_HOUSES: readonly [readonly string[], string][] = [
  [['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'], 'house-js'],
  [['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'], 'house-js'],
  [['py'], 'house-python'],
  [['go'], 'house-go'],
  [['rs'], 'house-rust'],
  [['java', 'kt', 'kts', 'scala'], 'house-java'],
  [['c', 'cc', 'cpp', 'h', 'hpp', 'cxx'], 'house-c'],
  [['rb'], 'house-ruby'],
  [['sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'conf', 'json'], 'house-shell'],
  // Media/asset files (small-town mode gives files their own lots): green space.
  [
    ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'mp3', 'mp4', 'woff', 'woff2', 'ttf'],
    'park-fountain',
  ],
];

export interface DirMatchInput {
  /** Directory basename, e.g. "components". */
  name: string;
  /** Full path from repo root, e.g. "src/components". */
  path: string;
  isRoot: boolean;
  /** Direct (non-recursive) file count. */
  fileCount: number;
  /** Most common file extension among direct files, lowercase, no dot. */
  dominantExt: string;
}

/** Rotates a set into a deterministic order keyed by the path hash. */
function hashOrdered(set: readonly string[], path: string): string[] {
  const h = hashPath(path);
  const start = h % set.length;
  const second = (start + 1 + ((h >>> 8) % (set.length - 1))) % set.length;
  const out = [set[start], set[second]];
  for (const id of set) if (!out.includes(id)) out.push(id);
  return out.filter((id): id is string => id !== undefined);
}

/**
 * Ordered candidate archetypes for a directory (2+, deduped). candidates[0]
 * is the primary; the rest are alternates for the diversify pass. See the
 * precedence comment above.
 */
export function matchCandidates(input: DirMatchInput): string[] {
  if (input.isRoot) return ['city-hall'];
  const name = input.name.toLowerCase();
  const path = input.path.toLowerCase();
  const candidates: string[] = [];
  const push = (id: string): void => {
    if (!candidates.includes(id)) candidates.push(id);
  };

  // Tier 0/1: semantic matches keep full authority — a test dir is a test
  // lab no matter its size.
  for (const spec of ARCHETYPES) {
    if (!spec.names?.includes(name)) continue;
    if (spec.maxFiles !== undefined && input.fileCount > spec.maxFiles) continue;
    push(spec.id);
  }
  for (const spec of ARCHETYPES) {
    if (!spec.patterns?.some((p) => p.test(path))) continue;
    if (spec.maxFiles !== undefined && input.fileCount > spec.maxFiles) continue;
    push(spec.id);
  }
  // Size tier: hash-ordered variety sets instead of one fixed archetype.
  if (input.fileCount >= ARCHETYPE_CONFIG.officeFileThreshold) {
    for (const id of hashOrdered(DOWNTOWN_SET, input.path)) push(id);
  } else if (input.fileCount >= ARCHETYPE_CONFIG.apartmentFileThreshold) {
    for (const id of hashOrdered(MIDTOWN_SET, input.path)) push(id);
  }
  // Extension fallback, then the unconditional default.
  for (const [exts, id] of EXTENSION_HOUSES) {
    if (exts.includes(input.dominantExt)) push(id);
  }
  push('house-generic');
  return candidates.slice(0, 4);
}

/** Primary archetype for a directory: candidates[0]. */
export function matchDirectory(input: DirMatchInput): string {
  return matchCandidates(input)[0] ?? 'house-generic';
}

/** Plaza landmarks for well-known root files; null = no landmark. */
export function matchRootFile(fileName: string): string | null {
  const n = fileName.toLowerCase();
  if (n.startsWith('readme')) return 'newsstand';
  if (n.startsWith('changelog')) return 'clock-tower';
  // The entry point guides everything into the harbor.
  if (/^index\.[a-z]+$/.test(n) || n === 'main.py' || n === 'main.go' || n === 'main.rs') {
    return 'lighthouse';
  }
  if (
    n.startsWith('license') ||
    n.startsWith('licence') ||
    n.startsWith('code_of_conduct') ||
    n.startsWith('governance')
  ) {
    return 'church';
  }
  if (
    n === 'package-lock.json' ||
    n === 'yarn.lock' ||
    n === 'pnpm-lock.yaml' ||
    n === 'cargo.lock' ||
    n === 'poetry.lock' ||
    n === 'gemfile.lock' ||
    n === 'composer.lock' ||
    n === 'go.sum'
  ) {
    return 'city-archive';
  }
  return null;
}

// --- Instancing -------------------------------------------------------------------

export interface InstanceOptions {
  /** Deterministic seed source: the directory/file path. */
  path: string;
  /** Direct file count (drives height/size within the archetype's range). */
  fileCount: number;
  /** Cap on footprint so a lot can force a smaller build. */
  maxFootprint?: number;
}

/** Chosen footprint for an instance (needed by layout before building). */
export function instanceFootprint(id: string, opts: InstanceOptions): number {
  const spec = archetypeById(id);
  const t = Math.min(1, opts.fileCount / ARCHETYPE_CONFIG.fileCountForMaxHeight);
  const variant = hashPath(opts.path) / 0xffffffff;
  const [lo, hi] = spec.sizeRange;
  const size = lo + (hi - lo) * (0.6 * t + 0.4 * variant);
  return opts.maxFootprint !== undefined ? Math.min(size, opts.maxFootprint) : size;
}

/** Builds one archetype instance centered at origin, base at y=0. */
export function buildArchetype(id: string, opts: InstanceOptions): BuildingHandle {
  const spec = archetypeById(id);
  const kit = newKit();
  const variant = hashPath(opts.path) / 0xffffffff;
  // Blend the path hash into height so equally-large dirs (common in big
  // repos, where file counts all saturate the cap) still vary in height.
  const countT = Math.min(1, opts.fileCount / ARCHETYPE_CONFIG.fileCountForMaxHeight);
  const heightT = 0.7 * countT + 0.3 * variant;
  spec.build({ kit, s: instanceFootprint(id, opts), variant, heightT });
  return assemble(kit);
}
