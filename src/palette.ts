// Repo City palette — every color the renderer may use, as spec'd for Phase 1.
// All values are hex strings consumed by THREE.Color; nothing in scene code
// hardcodes a color literal.

export const PALETTE = {
  // Terrain
  water: '#2a4fd6', // deep water along the east edge
  shore: '#4a7ae8', // dithered shore band between water and beach
  beach: '#d6b96a', // sand strip
  grass: '#4a9e3f', // base grass fill
  grassGrid: '#3f8a35', // faint tile-grid line drawn over grass
  dirt: '#a8874f', // outskirt dirt patches
  // Trees
  canopy: '#2f6e2a', // tree canopy, lit side
  canopyShade: '#1f4f1e', // tree canopy, shaded side
  trunk: '#6b4a2a',
  // Roads
  asphalt: '#7a7a74',
  dash: '#d9d9d0', // lane dashes
  sidewalk: '#b8b3a0',
  // Buildings
  brick: '#b5533f',
  concrete: '#c9c4b4',
  glassLight: '#5f8fd9', // lit window glass
  glassDark: '#3f6aa8', // unlit window glass
  civic: '#d9c48f', // civic sandstone
  industrial: '#8f9299',
  rust: '#a8623f',
  roofBrown: '#6b4a3f',
  roofSlate: '#4a4a55',
  roofRed: '#8f3f3f',
  // UI
  selection: '#f2d33d', // selection highlight (unused this phase, reserved)
  // Sky
  sky: '#8fb4d9', // flat clear-color backdrop, era "midday haze" blue
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Fleet palette: vehicle body color by the bound file's language, mirroring
 * the language-house mapping in archetypes.ts so a JS rowhouse district's
 * traffic reads in the same family. Keys are language ids, not extensions.
 */
export const FLEET_PALETTE = {
  js: '#f2d33d', // JS/TS: cab yellow
  web: '#5f8fd9', // html/css: glass blue
  python: '#3f6aa8', // deep blue
  go: '#4a7ae8', // shore blue
  rust: '#a8623f', // rust, naturally
  java: '#b5533f', // brick
  c: '#8f9299', // industrial grey
  ruby: '#8f3f3f', // deep red
  shell: '#c9c4b4', // concrete
  media: '#4a9e3f', // grass green
  other: '#b8b3a0', // sidewalk beige
} as const;

export type FleetLanguage = keyof typeof FLEET_PALETTE;
