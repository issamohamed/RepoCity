import type { CitySource, FileRecord } from './types';

// --- Ingestion tuning --------------------------------------------------------
export const SOURCE_CONFIG = {
  /** Directory names excluded from every source (never become districts). */
  ignoredDirs: ['node_modules', '.git', 'dist', 'build', 'vendor'],
} as const;

/** True when any path segment is an ignored directory. */
export function isIgnoredPath(path: string): boolean {
  const segments = path.split('/');
  // Last segment is the file name; only directory segments are checked.
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg !== undefined && (SOURCE_CONFIG.ignoredDirs as readonly string[]).includes(seg)) {
      return true;
    }
  }
  return false;
}

/** Filters a raw record list through the shared ignore rules. */
export function filterRecords(files: FileRecord[]): FileRecord[] {
  return files.filter((f) => !isIgnoredPath(f.path));
}

/**
 * Built-in kitchen-sink city ("metropolis" in the scan box): a synthetic repo
 * shaped to trigger every archetype match rule at once — every named
 * directory, every language house, several big anonymous source dirs for the
 * downtown tower variety set, and enough files that all ten civic amenities
 * spawn. Offline, deterministic, and clearly labeled as a demo.
 */
export function kitchenSinkSource(): CitySource {
  const files: FileRecord[] = [];
  const gen = (dir: string, count: number, ext: string, kb = 3): void => {
    for (let i = 0; i < count; i++) {
      files.push({ path: `${dir}/file${i}.${ext}`, size: kb * 1000 + i * 37 });
    }
  };
  // Root landmarks: newsstand, clock tower, church, archive, lighthouse.
  files.push({ path: 'README.md', size: 5200 });
  files.push({ path: 'CHANGELOG.md', size: 9400 });
  files.push({ path: 'LICENSE', size: 1100 });
  files.push({ path: 'package-lock.json', size: 380000 });
  files.push({ path: 'index.ts', size: 900 });
  // One district per named rule (file counts sized to fit each archetype).
  gen('lib', 12, 'ts'); // library
  gen('secrets', 4, 'pem'); // bank vault
  gen('security', 7, 'ts'); // police station
  gen('rules', 6, 'ts'); // courthouse
  gen('docs', 240, 'md'); // school
  gen('logging', 8, 'ts'); // hospital
  gen('alerts', 5, 'ts'); // fire station
  gen('scripts', 9, 'sh'); // factory
  gen('core', 30, 'ts'); // power plant
  gen('config', 4, 'json'); // water tower
  gen('data', 160, 'json'); // warehouse
  gen('test', 320, 'ts'); // test lab
  gen('api', 24, 'ts'); // post office
  gen('jobs', 11, 'ts'); // train station
  gen('events', 9, 'ts'); // radio tower
  gen('public', 140, 'png'); // park with fountain
  gen('examples', 220, 'ts'); // playground
  gen('.github/workflows', 3, 'yml'); // customs house
  gen('components', 90, 'tsx'); // apartment
  gen('benchmarks', 14, 'ts'); // stadium
  gen('legacy', 10, 'js'); // museum
  gen('cache', 6, 'tmp'); // hotel
  gen('store', 12, 'ts'); // department store
  gen('fuzz', 8, 'ts'); // casino
  gen('themes', 9, 'css'); // theater
  gen('analytics', 12, 'ts'); // observation tower
  gen('db', 16, 'sql'); // grain silos
  gen('migrations', 22, 'sql'); // tank farm
  gen('docker', 6, 'yaml'); // container port
  gen('filters', 7, 'ts'); // water treatment
  // Anonymous big source dirs: feed the downtown tower variety set.
  // sequoia/equinox chosen because their path hashes land on the art-deco
  // and twin-tower archetypes, guaranteeing full skyline coverage. Each gets
  // subdirectories too, so districts have interior blocks and sub-roads like
  // a real large repo instead of one flat lot per district.
  const subNames = ['atlas', 'binder', 'crank', 'dynamo', 'ember2', 'flume'];
  for (const name of [
    'orchid',
    'falcon',
    'meridian',
    'aurora',
    'zephyr',
    'catalyst',
    'basalt',
    'juniper',
    'sequoia',
    'equinox',
  ]) {
    gen(name, 60, 'ts');
    subNames.forEach((sub, i) => {
      gen(`${name}/${sub}`, 8 + i * 7, 'ts');
    });
  }
  // Deep structure inside the big named districts as well.
  gen('docs/guides', 40, 'md');
  gen('docs/reference', 60, 'md');
  gen('test/unit', 80, 'ts');
  gen('test/integration', 60, 'ts');
  gen('examples/webgl', 70, 'ts');
  gen('examples/canvas', 40, 'ts');
  gen('data/fixtures', 50, 'json');
  gen('public/textures', 60, 'png');
  // Mid-size anonymous dirs: apartments / condos / parking via midtown set.
  for (const name of ['harbor', 'quartz', 'willow', 'ember']) {
    gen(name, 11, 'ts');
  }
  // Language homes: small dirs with one dominant extension each.
  gen('alpha', 2, 'py');
  gen('beta', 2, 'go');
  gen('gamma', 2, 'rs');
  gen('delta', 2, 'java');
  gen('epsilon', 2, 'c');
  gen('zeta', 2, 'rb');
  gen('eta', 2, 'sh');
  gen('theta', 2, 'js'); // JS rowhouse
  gen('iota', 2, 'xyz'); // unknown extension → generic house
  return {
    files,
    displayName: 'metropolis',
    sourceType: 'example',
    truncated: false,
  };
}

/**
 * Built-in example city: a plausible mid-size web-app repo, hand-written so
 * "Try an example" works offline and exercises many archetype match rules.
 * Sizes are invented but the shape is honest to a real codebase's layout.
 */
export function exampleSource(): CitySource {
  const spec: [string, number][] = [
    ['README.md', 4200],
    ['CHANGELOG.md', 9100],
    ['LICENSE', 1100],
    ['CODE_OF_CONDUCT.md', 3300],
    ['package.json', 1800],
    ['package-lock.json', 412000],
    ['tsconfig.json', 600],
    ['.env.example', 240],
    ['.github/workflows/ci.yml', 1500],
    ['.github/workflows/release.yml', 1100],
    ['src/index.ts', 900],
    ['src/app.ts', 2400],
    ['src/components/Button.tsx', 1800],
    ['src/components/Modal.tsx', 3200],
    ['src/components/Navbar.tsx', 2700],
    ['src/components/Table.tsx', 4100],
    ['src/components/Tooltip.tsx', 1300],
    ['src/components/Form.tsx', 3600],
    ['src/components/Card.tsx', 1500],
    ['src/components/Tabs.tsx', 2200],
    ['src/core/engine.ts', 8800],
    ['src/core/scheduler.ts', 5400],
    ['src/core/registry.ts', 3100],
    ['src/api/routes.ts', 2900],
    ['src/api/controllers/users.ts', 3300],
    ['src/api/controllers/orders.ts', 4100],
    ['src/api/endpoints.ts', 1700],
    ['src/middleware/auth.ts', 2600],
    ['src/middleware/rateLimit.ts', 1900],
    ['src/validators/schema.ts', 3800],
    ['src/validators/rules.ts', 2100],
    ['src/events/bus.ts', 2000],
    ['src/events/sockets.ts', 3500],
    ['src/workers/emailQueue.ts', 2800],
    ['src/workers/imageJobs.ts', 3900],
    ['src/logging/logger.ts', 1600],
    ['src/logging/monitor.ts', 2300],
    ['src/utils/format.ts', 1200],
    ['src/utils/date.ts', 900],
    ['src/utils/id.ts', 400],
    ['lib/parser.ts', 6100],
    ['lib/tokenizer.ts', 4400],
    ['config/default.json', 800],
    ['config/production.json', 700],
    ['keys/README.md', 300],
    ['scripts/build.sh', 1000],
    ['scripts/deploy.sh', 1400],
    ['test/app.test.ts', 3100],
    ['test/components/Button.test.ts', 1900],
    ['test/components/Modal.test.ts', 2500],
    ['test/core/engine.test.ts', 4200],
    ['docs/getting-started.md', 5200],
    ['docs/api.md', 8800],
    ['examples/basic/main.ts', 1100],
    ['examples/advanced/main.ts', 2300],
    ['public/favicon.ico', 4300],
    ['public/logo.png', 18000],
    ['assets/hero.jpg', 240000],
    ['data/fixtures/users.json', 52000],
    ['data/mocks/orders.json', 31000],
  ];
  return {
    files: spec.map(([path, size]) => ({ path, size })),
    displayName: 'example-city',
    sourceType: 'example',
    truncated: false,
  };
}
