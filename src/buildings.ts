import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';

// --- Building construction tuning -------------------------------------------
export const BUILDING_CONFIG = {
  // Face tint multipliers, baked into vertex colors exactly like era
  // pre-rendered sprites: sun sits to the southeast (+x, -z).
  tintSunFace: 1.0, // +x, faces the sun
  tintSideLit: 0.88, // -z, grazing light
  tintTop: 0.96, // roofs and tops
  tintSideShade: 0.72, // +z, away from grazing light
  tintDarkFace: 0.6, // -x, opposite the sun
  /** Window texture painting resolution, px per window cell. */
  windowCellPx: 8,
  /** Sign board size (world units) and canvas resolution. */
  signWidth: 1.7,
  signHeight: 0.55,
  signPostHeight: 0.9,
  signCanvasW: 64,
  signCanvasH: 20,
  /** Max characters painted on a sign before truncation with an ellipsis. */
  signMaxChars: 12,
} as const;

/**
 * Bakes per-face tints into vertex colors using face normals; `base` is the
 * part color, multiplied by the directional tint. Call AFTER rotations so
 * tints match final orientation. Returns the same geometry for chaining.
 */
export function bakeFaceTints<T extends THREE.BufferGeometry>(geo: T, base: THREE.Color): T {
  const c = BUILDING_CONFIG;
  const normal = geo.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    let tint: number;
    if (ny > 0.5) tint = c.tintTop;
    else if (ny < -0.5) tint = c.tintDarkFace;
    else {
      // Blend the four cardinal tints by horizontal normal direction.
      const east = Math.max(nx, 0) * c.tintSunFace + Math.max(-nx, 0) * c.tintDarkFace;
      const north = Math.max(-nz, 0) * c.tintSideLit + Math.max(nz, 0) * c.tintSideShade;
      const wx = Math.abs(nx);
      const wz = Math.abs(nz);
      tint = wx + wz > 0 ? (east * wx + north * wz) / (wx + wz) : c.tintTop;
    }
    colors[i * 3] = base.r * tint;
    colors[i * 3 + 1] = base.g * tint;
    colors[i * 3 + 2] = base.b * tint;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function pixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Shared detail textures ---------------------------------------------------
// One texture per style, shared by every instance of every archetype that uses
// it (spec requirement). App-lifetime cache: city disposal must NOT clear it.

export type TextureKey =
  | 'glass' // office/glass tower window grid
  | 'smallWindows' // dense apartment windows
  | 'brickWindows' // brick wall with windows
  | 'civicWindows' // sandstone wall with tall windows
  | 'barredWindows' // bank/vault small barred windows
  | 'mailSlots' // post-office slot rows
  | 'dockDoors' // warehouse loading doors
  | 'awning'; // newsstand stripes

const textureCache = new Map<TextureKey, THREE.CanvasTexture>();

function paintGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wall: string,
  cols: number,
  rows: number,
  paintCell: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    cw: number,
    ch: number,
    i: number,
  ) => void,
): void {
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      paintCell(ctx, col * cw, r * ch, cw, ch, i++);
    }
  }
}

/** Lazily builds and caches the shared canvas texture for a style. */
export function sharedTexture(key: TextureKey): THREE.CanvasTexture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const cell = BUILDING_CONFIG.windowCellPx;
  const canvas = document.createElement('canvas');
  const ctx2 = canvas.getContext('2d');
  if (!ctx2) throw new Error('2D canvas unavailable');
  const glassAt = (i: number): string =>
    (i * 17) % 5 < 3 ? PALETTE.glassDark : PALETTE.glassLight;

  switch (key) {
    case 'glass':
      canvas.width = cell * 5;
      canvas.height = cell * 10;
      paintGrid(
        ctx2,
        canvas.width,
        canvas.height,
        PALETTE.industrial,
        5,
        10,
        (c, x, y, w, h, i) => {
          c.fillStyle = glassAt(i);
          c.fillRect(x + 2, y + 2, w - 4, h - 4);
        },
      );
      break;
    case 'smallWindows':
      canvas.width = cell * 6;
      canvas.height = cell * 8;
      paintGrid(
        ctx2,
        canvas.width,
        canvas.height,
        PALETTE.concrete,
        6,
        8,
        (c, x, y, w, h, i) => {
          c.fillStyle = glassAt(i);
          c.fillRect(x + 3, y + 3, w - 5, h - 5);
        },
      );
      break;
    case 'brickWindows':
      canvas.width = cell * 4;
      canvas.height = cell * 3;
      paintGrid(ctx2, canvas.width, canvas.height, PALETTE.brick, 4, 3, (c, x, y, w, h, i) => {
        c.fillStyle = glassAt(i + 1);
        c.fillRect(x + 2, y + 2, w - 4, h - 3);
      });
      break;
    case 'civicWindows':
      canvas.width = cell * 5;
      canvas.height = cell * 2;
      paintGrid(ctx2, canvas.width, canvas.height, PALETTE.civic, 5, 2, (c, x, y, w, h) => {
        c.fillStyle = PALETTE.glassDark;
        c.fillRect(x + 2, y + 1, w - 4, h - 2);
      });
      break;
    case 'barredWindows':
      canvas.width = cell * 4;
      canvas.height = cell * 2;
      paintGrid(ctx2, canvas.width, canvas.height, PALETTE.concrete, 4, 2, (c, x, y, w, h) => {
        c.fillStyle = PALETTE.glassDark;
        c.fillRect(x + 2, y + 2, w - 4, h - 4);
        c.fillStyle = PALETTE.industrial;
        c.fillRect(x + Math.floor(w / 2), y + 2, 1, h - 4); // the bar
      });
      break;
    case 'mailSlots':
      canvas.width = cell * 6;
      canvas.height = cell * 4;
      paintGrid(ctx2, canvas.width, canvas.height, PALETTE.civic, 6, 4, (c, x, y, w, h) => {
        c.fillStyle = PALETTE.glassDark;
        c.fillRect(x + 1, y + Math.floor(h / 2), w - 2, 2); // slot row
      });
      break;
    case 'dockDoors':
      canvas.width = cell * 4;
      canvas.height = cell * 2;
      paintGrid(
        ctx2,
        canvas.width,
        canvas.height,
        PALETTE.industrial,
        4,
        1,
        (c, x, y, w, h) => {
          c.fillStyle = PALETTE.rust;
          c.fillRect(x + 2, y + Math.floor(h * 0.25), w - 4, Math.floor(h * 0.75));
        },
      );
      break;
    case 'awning':
      canvas.width = cell * 4;
      canvas.height = cell;
      paintGrid(
        ctx2,
        canvas.width,
        canvas.height,
        PALETTE.roofRed,
        8,
        1,
        (c, x, y, w, h, i) => {
          if (i % 2 === 0) {
            c.fillStyle = PALETTE.dash;
            c.fillRect(x, y, w, h);
          }
        },
      );
      break;
  }
  const texture = pixelTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}

// --- Part kit -----------------------------------------------------------------
// Silhouette functions push transformed, tint-baked geometries into a PartKit;
// assemble() merges them into at most one mesh per material for draw-call
// economy (solids share one vertex-colored material; textured parts one mesh
// per texture key).

export interface PartKit {
  solids: THREE.BufferGeometry[];
  textured: Map<TextureKey, THREE.BufferGeometry[]>;
}

export function newKit(): PartKit {
  return { solids: [], textured: new Map() };
}

interface PlaceOpts {
  /** Rotation around Y in radians, applied before tint baking. */
  ry?: number;
  /** Rotation around Z in radians (tilted parts like slides, barrier arms). */
  rz?: number;
  /** Rotation around X in radians. */
  rx?: number;
  /** Non-uniform scale (ovals, stretched domes), applied before rotation. */
  sx?: number;
  sz?: number;
}

function place(
  geo: THREE.BufferGeometry,
  x: number,
  yCenter: number,
  z: number,
  o?: PlaceOpts,
): THREE.BufferGeometry {
  if (o?.sx !== undefined || o?.sz !== undefined) geo.scale(o.sx ?? 1, 1, o.sz ?? 1);
  if (o?.rx) geo.rotateX(o.rx);
  if (o?.rz) geo.rotateZ(o.rz);
  if (o?.ry) geo.rotateY(o.ry);
  geo.translate(x, yCenter, z);
  return geo;
}

/** Box with base at y; solid color. */
export function box(
  kit: PartKit,
  color: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  o?: PlaceOpts,
): void {
  const geo = new THREE.BoxGeometry(w, h, d);
  place(geo, x, y + h / 2, z, o);
  kit.solids.push(bakeFaceTints(geo, new THREE.Color(color)));
}

/** Cylinder (or tapered cylinder) with base at y; solid color. */
export function cyl(
  kit: PartKit,
  color: string,
  rTop: number,
  rBottom: number,
  h: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  o?: PlaceOpts,
): void {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments);
  place(geo, x, y + h / 2, z, o);
  kit.solids.push(bakeFaceTints(geo, new THREE.Color(color)));
}

/** Cone with base at y; solid color. 4 segments + ry PI/4 = square hip roof. */
export function cone(
  kit: PartKit,
  color: string,
  r: number,
  h: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  o?: PlaceOpts,
): void {
  const geo = new THREE.ConeGeometry(r, h, segments);
  place(geo, x, y + h / 2, z, o);
  kit.solids.push(bakeFaceTints(geo, new THREE.Color(color)));
}

/** Rectangular hip roof: 4-sided cone rotated square, stretched to w x d. */
export function hipRoof(
  kit: PartKit,
  color: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): void {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, h, 4);
  geo.rotateY(Math.PI / 4);
  geo.scale(w, 1, d);
  geo.translate(x, y + h / 2, z);
  kit.solids.push(bakeFaceTints(geo, new THREE.Color(color)));
}

/** Half dome (civic). */
export function dome(
  kit: PartKit,
  color: string,
  r: number,
  x: number,
  y: number,
  z: number,
): void {
  const geo = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.translate(x, y, z);
  kit.solids.push(bakeFaceTints(geo, new THREE.Color(color)));
}

/** Box with base at y wearing a shared window/detail texture (tint-baked). */
export function texBox(
  kit: PartKit,
  tex: TextureKey,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  o?: PlaceOpts,
): void {
  const geo = new THREE.BoxGeometry(w, h, d);
  place(geo, x, y + h / 2, z, o);
  bakeFaceTints(geo, WHITE);
  let list = kit.textured.get(tex);
  if (!list) {
    list = [];
    kit.textured.set(tex, list);
  }
  list.push(geo);
}

const WHITE = new THREE.Color('#ffffff');

// One shared vertex-color material for all merged solid parts, app lifetime.
const solidMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const texturedMaterials = new Map<TextureKey, THREE.MeshBasicMaterial>();

function texturedMaterial(key: TextureKey): THREE.MeshBasicMaterial {
  let mat = texturedMaterials.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ map: sharedTexture(key), vertexColors: true });
    texturedMaterials.set(key, mat);
  }
  return mat;
}

export interface BuildingHandle {
  group: THREE.Group;
  /** Disposes per-instance geometry (shared textures/materials survive). */
  dispose: () => void;
}

/** Merges a kit into 1 solid mesh + 1 mesh per texture key. */
export function assemble(kit: PartKit): BuildingHandle {
  const group = new THREE.Group();
  const merged: THREE.BufferGeometry[] = [];
  if (kit.solids.length > 0) {
    const solidGeo = mergeGeometries(kit.solids, false);
    for (const g of kit.solids) g.dispose();
    if (solidGeo) {
      merged.push(solidGeo);
      group.add(new THREE.Mesh(solidGeo, solidMaterial));
    }
  }
  for (const [key, geos] of kit.textured) {
    const texGeo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (texGeo) {
      merged.push(texGeo);
      group.add(new THREE.Mesh(texGeo, texturedMaterial(key)));
    }
  }
  return {
    group,
    dispose: () => {
      for (const g of merged) g.dispose();
    },
  };
}

// --- Signs ---------------------------------------------------------------------

/** Yaw that faces a board toward the default (yaw 45) camera. */
const SIGN_FACING = Math.PI / 4;

/**
 * Post + board sign naming a directory. Each sign's text texture is unique,
 * so the handle disposes it along with the geometry.
 */
export function makeSign(text: string, x: number, z: number): BuildingHandle {
  const c = BUILDING_CONFIG;
  const canvas = document.createElement('canvas');
  canvas.width = c.signCanvasW;
  canvas.height = c.signCanvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = PALETTE.sidewalk;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = PALETTE.roofBrown;
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.fillStyle = '#20201c';
  ctx.font = 'bold 9px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const label = text.length > c.signMaxChars ? `${text.slice(0, c.signMaxChars - 1)}…` : text;
  ctx.fillText(label.toUpperCase(), canvas.width / 2, canvas.height / 2 + 1);
  const texture = pixelTexture(canvas);

  const group = new THREE.Group();
  const postGeo = new THREE.BoxGeometry(0.08, c.signPostHeight, 0.08);
  postGeo.translate(0, c.signPostHeight / 2, 0);
  bakeFaceTints(postGeo, new THREE.Color(PALETTE.trunk));
  const post = new THREE.Mesh(postGeo, solidMaterial);

  const boardGeo = new THREE.PlaneGeometry(c.signWidth, c.signHeight);
  boardGeo.rotateY(SIGN_FACING);
  boardGeo.translate(0, c.signPostHeight + c.signHeight / 2, 0);
  const boardMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const board = new THREE.Mesh(boardGeo, boardMat);

  group.add(post, board);
  group.position.set(x, 0, z);
  return {
    group,
    dispose: () => {
      postGeo.dispose();
      boardGeo.dispose();
      boardMat.dispose();
      texture.dispose();
    },
  };
}

// --- Phase 1 demo trio (kept for the boot scene) --------------------------------

/** The three Phase 1 test archetypes, placed on one block of the demo grid. */
export function buildTestBuildings(): BuildingHandle {
  const kit = newKit();
  // Glass tower: 10 floors on a 4x4 footprint + slate roof slab.
  texBox(kit, 'glass', 4, 9, 4, 34, 0, 32);
  box(kit, PALETTE.roofSlate, 4.2, 0.3, 4.2, 34, 9, 32);
  // Civic hall: sandstone body, colonnade along -z, overhanging roof.
  texBox(kit, 'civicWindows', 7, 2.6, 4.5, 41, 0, 33.5);
  for (let i = 0; i < 6; i++) {
    cyl(kit, PALETTE.concrete, 0.18, 0.18, 2.6, 6, 38 + i * 1.2, 0, 30.9);
  }
  box(kit, PALETTE.civic, 7.6, 0.35, 5.9, 41, 2.6, 33.15);
  // Water tower: four rust legs, industrial tank, red cone cap.
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    cyl(kit, PALETTE.rust, 0.08, 0.08, 2.2, 5, 44.5 + sx * 0.6, 0, 30 + sz * 0.6);
  }
  cyl(kit, PALETTE.industrial, 0.9, 0.9, 1.4, 8, 44.5, 2.2, 30);
  cone(kit, PALETTE.roofRed, 1.0, 0.6, 8, 44.5, 3.6, 30);
  return assemble(kit);
}
