import type { CitySource } from './types';
import type { CityLayout } from './layout';
import { hashPath } from './archetypes';
import type { FleetLanguage } from './palette';

// --- Traffic planning tuning ---------------------------------------------------
export const TRAFFIC_PLAN_CONFIG = {
  /** Fraction of the vehicle budget given to the largest files; the rest is
   * a deterministic hash sample so small files are represented too. */
  largestFilesShare: 0.7,
} as const;

export type VehicleTypeId =
  | 'sedan'
  | 'taxi'
  | 'van'
  | 'box-truck'
  | 'bus'
  | 'motorcycle'
  | 'pickup'
  | 'garbage-truck'
  | 'mail-truck'
  | 'emergency';

/** Hash-pick pool for vehicles with no role override. */
const GENERAL_POOL: readonly VehicleTypeId[] = [
  'sedan',
  'taxi',
  'van',
  'box-truck',
  'motorcycle',
  'pickup',
];

export interface VehicleAssignment {
  filePath: string;
  fileName: string;
  size: number;
  language: FleetLanguage;
  typeId: VehicleTypeId;
  homeLotIndex: number;
  stopLotIndex: number;
  /** Honest, human-readable description of the inferred loop. */
  relationship: string;
}

const EXT_LANGUAGE: readonly [readonly string[], FleetLanguage][] = [
  [['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'], 'js'],
  [['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'], 'web'],
  [['py'], 'python'],
  [['go'], 'go'],
  [['rs'], 'rust'],
  [['java', 'kt', 'kts', 'scala'], 'java'],
  [['c', 'cc', 'cpp', 'h', 'hpp', 'cxx'], 'c'],
  [['rb'], 'ruby'],
  [['sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'conf', 'json'], 'shell'],
  [
    ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'mp3', 'mp4', 'woff', 'woff2', 'ttf'],
    'media',
  ],
];

function languageOf(fileName: string): FleetLanguage {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  for (const [exts, lang] of EXT_LANGUAGE) {
    if (exts.includes(ext)) return lang;
  }
  return 'other';
}

/** Strips extension and common test/spec suffixes: "Button.test.ts" → "button". */
function baseName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[._-](test|spec|tests|specs)$/, '')
    .replace(/^(test|spec)[._-]/, '');
}

function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(^|\/)(tests?|__tests__|specs?|e2e|cypress)(\/|$)/.test(lower) ||
    /[._-](test|spec)\.[a-z0-9]+$/.test(lower)
  );
}

function isDocFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || /(^|\/)(docs?|documentation|guides?|wiki)(\/|$)/.test(lower);
}

function isConfigFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /\.(json|ya?ml|toml|ini|conf|cfg|env)$/.test(lower) ||
    /(^|\/)(config|configs|settings|cfg)(\/|$)/.test(lower)
  );
}

/**
 * Assigns every planned vehicle a real file, a home lot, and a relationship
 * stop.
 *
 * THE LOOP HEURISTIC (honesty note): relationships are inferred from NAMES
 * ONLY — this is a cute naming heuristic, not static analysis, and there is
 * no import/dependency graph behind it. The exact rule, in order:
 *   1. Test files (test/spec dirs, or *.test.* / *.spec.* names) loop toward
 *      the home lot of the source file whose stripped basename matches the
 *      test's stripped basename ("Button.test.ts" → wherever "Button.tsx"
 *      lives). No match → the plaza.
 *   2. Doc files (.md, or under docs/) loop toward the school or library
 *      building if the city has one, else the plaza.
 *   3. Config files (.json/.yml/…, or under config/) loop toward the water
 *      tower (the utility building) if present, else city hall.
 *   4. Everything else loops home ↔ plaza.
 * Any UI describing these must say "likely" / "inferred", never "imports" or
 * "tests" as fact.
 */
export function planTraffic(
  source: CitySource,
  layout: CityLayout,
  vehicleBudget: number,
): VehicleAssignment[] {
  // Lot lookups. Amenity lots are decoration and never homes or stops.
  const lotByPath = new Map<string, number>();
  let cityHallIndex = 0;
  let schoolIndex = -1;
  let waterTowerIndex = -1;
  layout.lots.forEach((lot, i) => {
    if (lot.path.startsWith('amenity/')) return;
    lotByPath.set(lot.path, i);
    if (lot.archetypeId === 'city-hall') cityHallIndex = i;
    if (schoolIndex < 0 && (lot.archetypeId === 'school' || lot.archetypeId === 'library')) {
      schoolIndex = i;
    }
    if (waterTowerIndex < 0 && lot.archetypeId === 'water-tower') waterTowerIndex = i;
  });

  /** Deepest lot whose directory contains this file; city hall as fallback. */
  const homeLotOf = (filePath: string): number => {
    let dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
    for (;;) {
      const found = lotByPath.get(dir);
      if (found !== undefined) return found;
      if (dir === '') return cityHallIndex;
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
  };

  // Basename index over non-test files, for heuristic rule 1.
  const sourceByBase = new Map<string, string>();
  for (const f of source.files) {
    if (isTestFile(f.path)) continue;
    const name = f.path.split('/').pop() ?? f.path;
    const base = baseName(name);
    if (base !== '' && !sourceByBase.has(base)) sourceByBase.set(base, f.path);
  }

  // Pick which files get vehicles: largest first, then a hash-spread sample.
  const sorted = [...source.files].sort((a, b) => b.size - a.size);
  const largestCount = Math.min(
    sorted.length,
    Math.round(vehicleBudget * TRAFFIC_PLAN_CONFIG.largestFilesShare),
  );
  const chosen = sorted.slice(0, largestCount);
  const rest = sorted.slice(largestCount).sort((a, b) => hashPath(a.path) - hashPath(b.path));
  chosen.push(...rest.slice(0, Math.max(0, vehicleBudget - chosen.length)));

  const assignments: VehicleAssignment[] = [];
  for (const file of chosen) {
    const fileName = file.path.split('/').pop() ?? file.path;
    const homeLotIndex = homeLotOf(file.path);

    let stopLotIndex = cityHallIndex;
    let relationship = 'likely errand: home ↔ the plaza (no name match found)';
    if (isTestFile(file.path)) {
      const match = sourceByBase.get(baseName(fileName));
      if (match !== undefined) {
        stopLotIndex = homeLotOf(match);
        relationship = `likely tests ${match} (name match — inferred, not analyzed)`;
      } else {
        relationship = 'test file with no name match — loops to the plaza';
      }
    } else if (isDocFile(file.path)) {
      if (schoolIndex >= 0) {
        stopLotIndex = schoolIndex;
        relationship = 'doc file: likely class trip to the school/library (inferred)';
      } else {
        relationship = 'doc file: loops to the plaza';
      }
    } else if (isConfigFile(file.path)) {
      if (waterTowerIndex >= 0) {
        stopLotIndex = waterTowerIndex;
        relationship = 'config file: likely utility run to the water tower (inferred)';
      } else {
        relationship = 'config file: loops to city hall';
      }
    }
    // A loop needs two distinct ends; degenerate ones fall back to the plaza,
    // or to the home district's door if home IS the plaza.
    if (stopLotIndex === homeLotIndex) {
      stopLotIndex =
        homeLotIndex === cityHallIndex ? (schoolIndex >= 0 ? schoolIndex : 0) : cityHallIndex;
    }

    const language = languageOf(fileName);
    const homeArchetype = layout.lots[homeLotIndex]?.archetypeId ?? '';
    const hash = hashPath(file.path);
    // Role overrides make the fleet legible; the rest hash into the pool.
    let typeId: VehicleTypeId;
    if (homeArchetype === 'post-office') typeId = 'mail-truck';
    else if (homeArchetype === 'hotel') typeId = 'garbage-truck';
    else if (homeArchetype === 'hospital' || homeArchetype === 'fire-station')
      typeId = 'emergency';
    else if (isDocFile(file.path)) typeId = 'bus';
    else typeId = GENERAL_POOL[hash % GENERAL_POOL.length] ?? 'sedan';

    assignments.push({
      filePath: file.path,
      fileName,
      size: file.size,
      language,
      typeId,
      homeLotIndex,
      stopLotIndex,
      relationship,
    });
  }
  return assignments;
}
