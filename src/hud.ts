import type { CitySource, FileRecord } from './types';
import type { DroppedFolder } from './dropzone';

// --- HUD tuning (era chrome arrives in Phase 3; this is functional styling) -----
export const HUD_CONFIG = {
  /** District name given to loose files dropped outside any folder. */
  looseDistrictName: 'Harborside',
} as const;

export interface HudCallbacks {
  onScan: (input: string) => void;
  onFound: (source: CitySource) => void;
  onExample: () => void;
  onEditToggle: () => void;
  onHome: () => void;
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

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

/** Top strip + staging tray + drop overlay. Vanilla DOM, disposed never (app chrome). */
export class Hud {
  private readonly cb: HudCallbacks;
  private readonly tray: DroppedFolder[] = [];
  private readonly input: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly populationEl: HTMLElement;
  private readonly trayEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly foundBtn: HTMLButtonElement;
  private readonly editBtn: HTMLButtonElement;

  constructor(cb: HudCallbacks) {
    this.cb = cb;
    const bar = el('div', 'hud-bar', document.body);
    el('span', 'hud-title', bar, 'REPO CITY');
    const homeBtn = el('button', 'hud-btn hud-btn-quiet', bar, '⌂');
    homeBtn.title = 'Back to the title screen';
    homeBtn.addEventListener('click', () => this.cb.onHome());

    this.input = el('input', 'hud-input', bar);
    this.input.placeholder = 'owner/repo or GitHub URL';
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.scan();
      e.stopPropagation(); // don't rotate the camera while typing
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());

    const scanBtn = el('button', 'hud-btn', bar, 'SCAN');
    scanBtn.addEventListener('click', () => this.scan());
    const exampleBtn = el('button', 'hud-btn hud-btn-quiet', bar, 'Try an example');
    exampleBtn.addEventListener('click', () => this.cb.onExample());
    this.editBtn = el('button', 'hud-btn hud-btn-quiet', bar, 'EDIT');
    this.editBtn.title = 'Toggle Edit Mode — a player sandbox, separate from the repo view';
    this.editBtn.addEventListener('click', () => this.cb.onEditToggle());

    this.populationEl = el('span', 'hud-population', bar, '');
    this.statusEl = el(
      'span',
      'hud-status',
      bar,
      'Scan a repo or drop a folder to found a city.',
    );

    this.trayEl = el('div', 'hud-tray', document.body);
    this.trayEl.style.display = 'none';
    this.chipsEl = el('div', 'hud-chips', this.trayEl);
    this.foundBtn = el('button', 'hud-btn hud-btn-found', this.trayEl, 'FOUND CITY');
    this.foundBtn.addEventListener('click', () => this.foundCity());
    el(
      'div',
      'hud-privacy',
      this.trayEl,
      'Files never leave your browser; only names and sizes are read.',
    );

    this.overlayEl = el(
      'div',
      'hud-drop-overlay',
      document.body,
      'Drop a folder to found a city!',
    );
    this.overlayEl.style.display = 'none';
  }

  private scan(): void {
    if (this.tray.length > 0) {
      if (!window.confirm('Scanning clears your dropped folders. Continue?')) return;
      this.clearTray();
    }
    this.cb.onScan(this.input.value);
  }

  /** Adds dropped folders as tray chips; numeric suffixes on name collisions. */
  addFolders(folders: DroppedFolder[]): void {
    for (const folder of folders) {
      let name = folder.name;
      let suffix = 2;
      while (this.tray.some((t) => t.name === name)) {
        name = `${folder.name}-${suffix}`;
        suffix++;
      }
      this.tray.push({ ...folder, name });
    }
    this.renderTray();
  }

  clearTray(): void {
    this.tray.length = 0;
    this.renderTray();
  }

  private renderTray(): void {
    this.chipsEl.textContent = '';
    this.trayEl.style.display = this.tray.length > 0 ? 'flex' : 'none';
    for (const folder of this.tray) {
      const chip = el('span', 'hud-chip', this.chipsEl);
      el('span', 'hud-chip-name', chip, folder.name);
      el(
        'span',
        'hud-chip-meta',
        chip,
        `${folder.files.length} files · ${fmtBytes(folder.totalSize)}`,
      );
      const remove = el('button', 'hud-chip-x', chip, '×');
      remove.addEventListener('click', () => {
        const i = this.tray.indexOf(folder);
        if (i >= 0) this.tray.splice(i, 1);
        this.renderTray();
      });
    }
  }

  /** Builds the CitySource from the tray: each folder a district, loose files
   * grouped under Harborside, then hands it to the app. */
  private foundCity(): void {
    if (this.tray.length === 0) return;
    const files: FileRecord[] = [];
    for (const folder of this.tray) {
      const prefix = folder.isLooseGroup
        ? `${HUD_CONFIG.looseDistrictName}/`
        : `${folder.name}/`;
      for (const f of folder.files) files.push({ path: prefix + f.path, size: f.size });
    }
    const first = this.tray[0];
    const source: CitySource = {
      files,
      displayName: this.tray.length === 1 && first ? first.name : `${this.tray.length} folders`,
      sourceType: 'local',
      truncated: false,
    };
    this.cb.onFound(source);
  }

  setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('hud-status-error', isError);
  }

  setSurveying(count: number): void {
    this.setStatus(`surveying: ${count.toLocaleString()} parcels`);
  }

  setPopulation(text: string): void {
    this.populationEl.textContent = text;
  }

  showDropOverlay(active: boolean): void {
    this.overlayEl.style.display = active ? 'flex' : 'none';
  }

  setEditActive(active: boolean): void {
    this.editBtn.classList.toggle('hud-btn-edit-active', active);
    this.editBtn.textContent = active ? 'EXIT EDIT' : 'EDIT';
  }
}
