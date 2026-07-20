import * as THREE from 'three';
import { ARCHETYPES, buildArchetype, instanceFootprint } from './archetypes';
import { makeSign, type BuildingHandle } from './buildings';
import { buildRoadPiece, buildBridgePiece, ROAD_CONFIG, type RoadPieceHandle } from './roads';
import type { CityLayout } from './layout';

// --- Edit Mode ---------------------------------------------------------------------
// A creative sandbox layered on top of the generated city, never a source of
// claims about the codebase. HONESTY RULE boundaries:
//  - The generated city (layout, lots, roads, traffic, query data) is never
//    mutated; player pieces live in their own scene group and placement list.
//  - Player pieces exist visually ONLY while Edit Mode is active (the group is
//    hidden on exit), so the honest view can never show invented buildings.
//  - Player pieces carry no path/size/file data anywhere: generic sign text,
//    and the inspector shows a "player-placed" note instead of codebase rows.
//  - Road/bridge pieces are decorative only: real road/deck art, but never
//    part of the routing graph — traffic drives only the honest network.
//  - Placements persist for the current city within the session; founding a
//    new city discards them.

export const EDIT_CONFIG = {
  /** Palette order: every archetype category in the reservoir. */
  categories: [
    'civic',
    'commerce',
    'residential',
    'homes',
    'industry',
    'infra',
    'parks',
  ] as const,
  /** Sign text for every player-placed building — deliberately generic. */
  signText: 'Custom Building',
  /** Player pieces size as if this many files lived there (visual midpoint). */
  ghostFileCount: 3,
  /** Gap (world units) required around a player piece, matching lotGap. */
  placeGap: 0.9,
  /** Road band clearance, matching layout.ts blocked(): half width + gap. */
  roadHalf: 1.3,
  /** Hole (plaza/pond) margin, matching layout.ts blocked(). */
  holePad: 1.2,
  /** Decorative road strip length, world units. */
  roadPieceLength: 6,
  /** Decorative bridge deck length, world units. */
  bridgePieceLength: 10,
} as const;

/** Decorative road/bridge palette entries (Edit Mode only, never graph). */
interface PieceDef {
  id: string;
  label: string;
  bridge: boolean;
  axis: 'x' | 'z';
}
const ROAD_PIECES: readonly PieceDef[] = [
  { id: 'road-ew', label: 'road (E–W)', bridge: false, axis: 'x' },
  { id: 'road-ns', label: 'road (N–S)', bridge: false, axis: 'z' },
  { id: 'bridge-ew', label: 'bridge (E–W)', bridge: true, axis: 'x' },
  { id: 'bridge-ns', label: 'bridge (N–S)', bridge: true, axis: 'z' },
];

type Armed = { kind: 'archetype'; id: string } | { kind: 'piece'; def: PieceDef } | null;

interface Placement {
  id: number;
  /** Palette label shown when selected. */
  label: string;
  kind: 'building' | 'road' | 'bridge';
  x: number;
  z: number;
  /** Half extents of the footprint rect, world units. */
  hx: number;
  hz: number;
  handles: (BuildingHandle | RoadPieceHandle)[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

/**
 * Edit Mode controller: palette panel, mode chrome, placement/selection state.
 * One session per hosted city; toggling the mode hides/shows the same session
 * (placements persist within the session), founding a new city resets it.
 */
export class EditMode {
  active = false;

  // Session state (valid while a city is hosted).
  private layout: CityLayout | null = null;
  private readonly group = new THREE.Group();
  private readonly placements: Placement[] = [];
  private nextId = 1;
  private armed: Armed = null;
  private selectedPlacement: Placement | null = null;
  /** When set, the next valid ground click relocates this piece. */
  private moving: Placement | null = null;

  // Ghost preview: one reused mesh, green = valid spot, red = blocked.
  private readonly ghostMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  private readonly ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), this.ghostMat);
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();

  // Chrome.
  private readonly badge: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly itemsEl: HTMLElement;
  private readonly selectionEl: HTMLElement;

  constructor() {
    this.ghost.visible = false;
    this.group.add(this.ghost);

    this.badge = el(
      'div',
      'edit-badge',
      document.body,
      'EDIT MODE — player sandbox, not repo data',
    );
    this.frame = el('div', 'edit-frame', document.body);

    this.panel = el('aside', 'edit-panel', document.body);
    this.panel.setAttribute('aria-label', 'Edit palette');
    const header = el('div', 'query-header', this.panel);
    el('span', 'query-title', header, 'BUILD PALETTE');
    const content = el('div', 'query-content', this.panel);
    el(
      'div',
      'query-note query-note-dim',
      content,
      'Click a piece, then click open ground. Click a placed piece to select it. Esc clears.',
    );
    this.itemsEl = el('div', 'edit-items', content);
    this.selectionEl = el('div', 'edit-selection', content);
    this.renderPalette();
    this.renderSelection();
    this.setChromeVisible(false);
  }

  /** Palette entries come straight from the archetype reservoir, by category,
   * plus the decorative road/bridge pieces. */
  private renderPalette(): void {
    this.itemsEl.textContent = '';
    for (const category of EDIT_CONFIG.categories) {
      el('div', 'query-subhead', this.itemsEl, category);
      for (const spec of ARCHETYPES) {
        if (spec.category !== category) continue;
        const btn = el('button', 'edit-item', this.itemsEl);
        el('span', `edit-chip edit-chip-${spec.category}`, btn);
        el('span', 'edit-item-name', btn, spec.id);
        btn.title = spec.description;
        btn.dataset.armId = spec.id;
        btn.addEventListener('click', () => {
          this.arm(
            this.armed?.kind === 'archetype' && this.armed.id === spec.id
              ? null
              : { kind: 'archetype', id: spec.id },
          );
        });
      }
    }
    el('div', 'query-subhead', this.itemsEl, 'roads & bridges (decorative)');
    for (const def of ROAD_PIECES) {
      const btn = el('button', 'edit-item', this.itemsEl);
      el('span', 'edit-chip edit-chip-infra', btn);
      el('span', 'edit-item-name', btn, def.label);
      btn.title = 'Decorative only — traffic never drives player-placed roads.';
      btn.dataset.armId = def.id;
      btn.addEventListener('click', () => {
        this.arm(
          this.armed?.kind === 'piece' && this.armed.def.id === def.id
            ? null
            : { kind: 'piece', def },
        );
      });
    }
  }

  private arm(next: Armed): void {
    this.armed = next;
    this.selectedPlacement = null;
    this.moving = null;
    this.ghost.visible = false;
    this.refreshItemHighlight();
    this.renderSelection();
  }

  private refreshItemHighlight(): void {
    const activeId =
      this.armed === null
        ? null
        : this.armed.kind === 'archetype'
          ? this.armed.id
          : this.armed.def.id;
    for (const child of this.itemsEl.querySelectorAll('.edit-item')) {
      child.classList.toggle(
        'edit-item-active',
        (child as HTMLElement).dataset.armId === activeId,
      );
    }
  }

  private renderSelection(): void {
    this.selectionEl.textContent = '';
    if (this.moving) {
      el(
        'div',
        'query-note',
        this.selectionEl,
        `Moving: ${this.moving.label}. Click a new spot (Esc cancels).`,
      );
      return;
    }
    if (this.selectedPlacement) {
      const p = this.selectedPlacement;
      el('div', 'query-subhead', this.selectionEl, 'selected piece');
      el('div', 'query-item', this.selectionEl, `${p.label} — player-placed`);
      el(
        'div',
        'query-note query-note-dim',
        this.selectionEl,
        p.kind === 'building'
          ? 'No codebase data: this building was placed by you, not generated from the repo.'
          : 'Decorative piece: traffic never uses player-placed roads or bridges.',
      );
      const moveBtn = el('button', 'hud-btn edit-move', this.selectionEl, 'MOVE');
      moveBtn.addEventListener('click', () => {
        this.moving = p;
        this.armed = null;
        this.refreshItemHighlight();
        this.renderSelection();
      });
      const delBtn = el('button', 'hud-btn edit-delete', this.selectionEl, 'DELETE');
      delBtn.addEventListener('click', () => {
        this.removePlacement(p);
        this.selectedPlacement = null;
        this.renderSelection();
      });
    } else if (this.armed) {
      const name = this.armed.kind === 'archetype' ? this.armed.id : this.armed.def.label;
      el(
        'div',
        'query-note',
        this.selectionEl,
        `Placing: ${name}. Click open ground inside the city.`,
      );
    }
  }

  /** Toggle for the HUD button. Returns the new active state. */
  toggle(scene: THREE.Scene, layout: CityLayout): boolean {
    if (this.active) {
      this.exit();
    } else {
      this.enter(scene, layout);
    }
    return this.active;
  }

  private enter(scene: THREE.Scene, layout: CityLayout): void {
    this.layout = layout;
    if (this.group.parent !== scene) scene.add(this.group);
    this.group.visible = true;
    this.active = true;
    this.setChromeVisible(true);
  }

  exit(): void {
    this.active = false;
    // Placements persist within the session, but the honest view never shows
    // player pieces: hide the whole layer on exit.
    this.group.visible = false;
    this.ghost.visible = false;
    this.armed = null;
    this.selectedPlacement = null;
    this.moving = null;
    this.refreshItemHighlight();
    this.renderSelection();
    this.setChromeVisible(false);
  }

  /** Founding a new city discards the sandbox (edits are per-city). */
  onCityChanged(): void {
    if (this.active) this.exit();
    for (const p of this.placements) {
      for (const h of p.handles) {
        this.group.remove(h.group);
        h.dispose();
      }
    }
    this.placements.length = 0;
    this.group.parent?.remove(this.group);
    this.layout = null;
  }

  clearSelection(): void {
    this.armed = null;
    this.selectedPlacement = null;
    this.moving = null;
    this.ghost.visible = false;
    this.refreshItemHighlight();
    this.renderSelection();
  }

  /**
   * Same buildable rules the generator obeys (layout.ts blocked()), on a
   * footprint rect: inside cityRect, clear of every hole (plaza, ponds) +
   * margin — EXCEPT bridge pieces, which are allowed over water (that is
   * their point) — clear of every road band, and not overlapping a generated
   * lot or another player piece. `ignore` exempts the piece being moved.
   */
  private canPlaceRect(
    x: number,
    z: number,
    hx: number,
    hz: number,
    allowWater: boolean,
    ignore: Placement | null = null,
  ): boolean {
    const layout = this.layout;
    if (!layout) return false;
    const r = layout.cityRect;
    if (x - hx < r.x0 || x + hx > r.x1 || z - hz < r.z0 || z + hz > r.z1) return false;
    if (!allowWater) {
      const holes = [layout.plaza, ...layout.ponds.map((p) => p.rect)];
      for (const hole of holes) {
        if (
          x + hx > hole.x0 - EDIT_CONFIG.holePad &&
          x - hx < hole.x1 + EDIT_CONFIG.holePad &&
          z + hz > hole.z0 - EDIT_CONFIG.holePad &&
          z - hz < hole.z1 + EDIT_CONFIG.holePad
        ) {
          return false;
        }
      }
    } else {
      // Bridges may span water but never the plaza.
      const hole = layout.plaza;
      if (
        x + hx > hole.x0 - EDIT_CONFIG.holePad &&
        x - hx < hole.x1 + EDIT_CONFIG.holePad &&
        z + hz > hole.z0 - EDIT_CONFIG.holePad &&
        z - hz < hole.z1 + EDIT_CONFIG.holePad
      ) {
        return false;
      }
    }
    // Bridges are exempt from the road-band rule: a deck whose end meets the
    // pond's ring road is exactly how a bridge should read. Buildings and
    // road strips still may not sit in a real road's band.
    for (const seg of allowWater ? [] : layout.segments) {
      const alongLo = seg.a - 0.3;
      const alongHi = seg.b + 0.3;
      const bandHalf = EDIT_CONFIG.roadHalf;
      const [aLo, aHi, cLo, cHi] =
        seg.axis === 'x' ? [x - hx, x + hx, z - hz, z + hz] : [z - hz, z + hz, x - hx, x + hx];
      if (aHi > alongLo && aLo < alongHi && cHi > seg.c - bandHalf && cLo < seg.c + bandHalf) {
        return false;
      }
    }
    const gap = EDIT_CONFIG.placeGap;
    for (const lot of layout.lots) {
      const lh = lot.footprint / 2;
      if (Math.abs(x - lot.x) < hx + lh + gap && Math.abs(z - lot.z) < hz + lh + gap) {
        return false;
      }
    }
    for (const p of this.placements) {
      if (p === ignore) continue;
      if (Math.abs(x - p.x) < hx + p.hx + gap && Math.abs(z - p.z) < hz + p.hz + gap) {
        return false;
      }
    }
    return true;
  }

  /** Footprint half-extents + water rule for whatever is armed or moving. */
  private pendingShape(): { hx: number; hz: number; allowWater: boolean } | null {
    if (this.moving) {
      return {
        hx: this.moving.hx,
        hz: this.moving.hz,
        allowWater: this.moving.kind === 'bridge',
      };
    }
    if (!this.armed) return null;
    if (this.armed.kind === 'archetype') {
      const f = this.footprintFor(this.armed.id, this.nextId);
      return { hx: f / 2, hz: f / 2, allowWater: false };
    }
    const def = this.armed.def;
    const len = def.bridge ? EDIT_CONFIG.bridgePieceLength : EDIT_CONFIG.roadPieceLength;
    const hw = ROAD_CONFIG.roadWidth / 2;
    return {
      hx: def.axis === 'x' ? len / 2 : hw,
      hz: def.axis === 'x' ? hw : len / 2,
      allowWater: def.bridge,
    };
  }

  /** Ghost preview while a piece is armed or moving; call from mousemove. */
  handleHover(raycaster: THREE.Raycaster): void {
    const shape = this.active && this.layout ? this.pendingShape() : null;
    if (!shape || !raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
      this.ghost.visible = false;
      return;
    }
    const x = Math.round(this.hitPoint.x * 2) / 2; // snap to half tiles
    const z = Math.round(this.hitPoint.z * 2) / 2;
    this.ghost.visible = true;
    this.ghost.scale.set(shape.hx * 2, 1, shape.hz * 2);
    this.ghost.position.set(x, 0.4, z);
    const ok = this.canPlaceRect(x, z, shape.hx, shape.hz, shape.allowWater, this.moving);
    this.ghostMat.color.set(ok ? 0x39c05a : 0xd04030);
  }

  /**
   * Click routing while Edit Mode is active. Order: a move in progress tries
   * to relocate; else an existing player piece under the cursor selects it;
   * else an armed palette piece places on valid open ground; else the click
   * clears the selection.
   */
  handleClick(raycaster: THREE.Raycaster): void {
    if (!this.active || !this.layout) return;
    if (this.moving) {
      if (raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
        const x = Math.round(this.hitPoint.x * 2) / 2;
        const z = Math.round(this.hitPoint.z * 2) / 2;
        const m = this.moving;
        if (this.canPlaceRect(x, z, m.hx, m.hz, m.kind === 'bridge', m)) {
          const dx = x - m.x;
          const dz = z - m.z;
          m.x = x;
          m.z = z;
          for (const h of m.handles) {
            h.group.position.x += dx;
            h.group.position.z += dz;
          }
          this.moving = null;
          this.selectedPlacement = m;
          this.ghost.visible = false;
          this.renderSelection();
        }
      }
      return;
    }
    const hits = raycaster.intersectObjects(this.group.children, true);
    for (const hit of hits) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        const id = o.userData.editPlacementId as number | undefined;
        if (id !== undefined) {
          this.selectedPlacement = this.placements.find((p) => p.id === id) ?? null;
          this.armed = null;
          this.ghost.visible = false;
          this.refreshItemHighlight();
          this.renderSelection();
          return;
        }
      }
    }
    const shape = this.pendingShape();
    if (shape && raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
      const x = Math.round(this.hitPoint.x * 2) / 2;
      const z = Math.round(this.hitPoint.z * 2) / 2;
      if (this.canPlaceRect(x, z, shape.hx, shape.hz, shape.allowWater)) {
        this.place(x, z, shape.hx, shape.hz);
        return;
      }
      return; // blocked spot: stay armed, ghost already shows red
    }
    this.selectedPlacement = null;
    this.renderSelection();
  }

  /** Deterministic per-piece variant seed (not a real path, carries no data). */
  private footprintFor(archetypeId: string, id: number): number {
    return instanceFootprint(archetypeId, {
      path: `custom/${archetypeId}-${id}`,
      fileCount: EDIT_CONFIG.ghostFileCount,
    });
  }

  private place(x: number, z: number, hx: number, hz: number): void {
    if (!this.armed) return;
    const id = this.nextId++;
    if (this.armed.kind === 'archetype') {
      const archetypeId = this.armed.id;
      const building = buildArchetype(archetypeId, {
        path: `custom/${archetypeId}-${id}`,
        fileCount: EDIT_CONFIG.ghostFileCount,
        maxFootprint: hx * 2,
      });
      building.group.position.set(x, 0, z);
      building.group.userData.editPlacementId = id;
      const sign = makeSign(EDIT_CONFIG.signText, x, z + hz + 0.5);
      sign.group.userData.editPlacementId = id;
      this.group.add(building.group, sign.group);
      this.placements.push({
        id,
        label: archetypeId,
        kind: 'building',
        x,
        z,
        hx,
        hz,
        handles: [building, sign],
      });
      return;
    }
    const def = this.armed.def;
    const len = def.bridge ? EDIT_CONFIG.bridgePieceLength : EDIT_CONFIG.roadPieceLength;
    const piece = def.bridge ? buildBridgePiece(def.axis, len) : buildRoadPiece(def.axis, len);
    piece.group.position.set(x, 0, z);
    piece.group.userData.editPlacementId = id;
    this.group.add(piece.group);
    this.placements.push({
      id,
      label: def.label,
      kind: def.bridge ? 'bridge' : 'road',
      x,
      z,
      hx,
      hz,
      handles: [piece],
    });
  }

  private removePlacement(p: Placement): void {
    for (const h of p.handles) {
      this.group.remove(h.group);
      h.dispose();
    }
    const i = this.placements.indexOf(p);
    if (i >= 0) this.placements.splice(i, 1);
  }

  private setChromeVisible(on: boolean): void {
    document.body.classList.toggle('edit-mode', on);
    this.badge.style.display = on ? 'block' : 'none';
    this.frame.style.display = on ? 'block' : 'none';
    this.panel.style.display = on ? 'block' : 'none';
  }

  /** Debug/test observability: placement count (read-only). */
  placementCount(): number {
    return this.placements.length;
  }

  /** Badge copy: Builder's Mode has no scanned repo behind it, so the default
   * "not repo data" framing would read oddly there. Still always honest. */
  setBadge(text: string): void {
    this.badge.textContent = text;
  }
}
