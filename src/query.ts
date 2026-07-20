import { archetypeById } from './archetypes';
import type { CityLayout } from './layout';
import type { CitySource } from './types';
import type { Traffic } from './traffic';
import type { VehicleAssignment } from './trafficstops';

// --- Query panel ------------------------------------------------------------------
// Slim grey-beveled inspector docked right, collapsed to an edge tab by
// default. Opens automatically on selection; the pin keeps it open. All data
// shown traces to path/size/extension/depth; relationship text comes straight
// from trafficstops.ts and is worded as inferred, never as fact.

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

export interface CityContext {
  layout: CityLayout;
  source: CitySource;
  traffic: Traffic | null;
}

export class QueryPanel {
  private readonly root: HTMLElement;
  private readonly tab: HTMLButtonElement;
  private readonly content: HTMLElement;
  private readonly title: HTMLElement;
  private readonly pinBtn: HTMLButtonElement;
  private pinned = false;
  private open = false;
  private context: CityContext | null = null;
  private rosterTimer: number | null = null;

  constructor() {
    this.root = el('aside', 'query-panel query-collapsed', document.body);
    this.root.setAttribute('aria-label', 'Query inspector');

    this.tab = el('button', 'query-tab', this.root, '◀ QUERY');
    this.tab.addEventListener('click', () => (this.open ? this.collapse() : this.expand()));

    const chrome = el('div', 'query-chrome', this.root);
    const header = el('div', 'query-header', chrome);
    this.title = el('span', 'query-title', header, 'CITY ROSTER');
    this.pinBtn = el('button', 'query-pin', header, '📌');
    this.pinBtn.title = 'Pin the panel open';
    this.pinBtn.setAttribute('aria-pressed', 'false');
    this.pinBtn.addEventListener('click', () => {
      this.pinned = !this.pinned;
      this.pinBtn.setAttribute('aria-pressed', String(this.pinned));
      this.pinBtn.classList.toggle('query-pin-active', this.pinned);
    });
    const closeBtn = el('button', 'query-close', header, '×');
    closeBtn.title = 'Collapse (Esc)';
    closeBtn.addEventListener('click', () => this.collapse(true));

    this.content = el('div', 'query-content', chrome);
    this.showRoster();
  }

  setContext(context: CityContext | null): void {
    this.context = context;
    this.showRoster();
  }

  expand(): void {
    this.open = true;
    this.root.classList.remove('query-collapsed');
    this.tab.textContent = '▶';
  }

  /** Esc / close always collapse; auto-collapse respects the pin. */
  collapse(force = false): void {
    if (this.pinned && !force) return;
    this.open = false;
    this.root.classList.add('query-collapsed');
    this.tab.textContent = '◀ QUERY';
  }

  get isOpen(): boolean {
    return this.open;
  }

  private row(label: string, value: string): void {
    const row = el('div', 'query-row', this.content);
    el('span', 'query-label', row, label);
    el('span', 'query-value', row, value);
  }

  private clearRoster(): void {
    if (this.rosterTimer !== null) {
      window.clearInterval(this.rosterTimer);
      this.rosterTimer = null;
    }
  }

  showBuilding(lotIndex: number): void {
    const ctx = this.context;
    const lot = ctx?.layout.lots[lotIndex];
    if (!ctx || !lot) return;
    this.clearRoster();
    this.content.textContent = '';
    this.title.textContent = 'BUILDING';

    const spec = archetypeById(lot.archetypeId);
    this.row('archetype', `${spec.id} (${spec.category})`);
    this.row('sign', lot.signText);
    if (lot.path.startsWith('amenity/')) {
      this.row('kind', 'civic amenity — decorative, count scales with city size');
    } else {
      this.row('path', lot.path === '' ? '(repo root)' : lot.path);
      this.row('resident files', String(lot.fileCount));
      this.row('size', fmtBytes(lot.totalSize));
      if (lot.mergedCount > 0) this.row('merged upward', `${lot.mergedCount} deeper dirs`);
      if (ctx.source.ownerRepo !== undefined && lot.path !== '') {
        const link = el('a', 'query-link', this.content, 'View on GitHub ↗');
        link.href = `https://github.com/${ctx.source.ownerRepo}/tree/${ctx.source.branch ?? 'main'}/${lot.path}`;
        link.target = '_blank';
        link.rel = 'noopener';
      }
    }
    const users = ctx.traffic?.vehiclesUsingLot(lotIndex) ?? [];
    if (users.length > 0) {
      el('div', 'query-subhead', this.content, `vehicles stopping here (${users.length})`);
      for (const v of users.slice(0, 6)) {
        el('div', 'query-item', this.content, `${v.typeId} · ${v.fileName}`);
      }
      if (users.length > 6)
        el('div', 'query-item', this.content, `…and ${users.length - 6} more`);
    }
    this.expand();
  }

  showVehicle(vehicleIndex: number): void {
    const ctx = this.context;
    const info = ctx?.traffic?.vehicleInfo(vehicleIndex);
    if (!ctx || !info) return;
    this.clearRoster();
    this.content.textContent = '';
    this.title.textContent = 'VEHICLE';

    const a: VehicleAssignment = info.assignment;
    const home = ctx.layout.lots[a.homeLotIndex];
    const stop = ctx.layout.lots[a.stopLotIndex];
    this.row('type', a.typeId);
    this.row('file', a.fileName);
    this.row('path', a.filePath);
    this.row('size', fmtBytes(a.size));
    this.row('language', a.language);
    this.row('home', home ? `${home.signText} (${home.archetypeId})` : '?');
    const target = info.outbound ? stop : home;
    const other = info.outbound ? home : stop;
    this.row(
      info.paused ? 'idling at' : 'heading to',
      target ? `${target.signText} (${target.archetypeId})` : '?',
    );
    this.row('then back to', other ? other.signText : '?');
    el('div', 'query-note', this.content, a.relationship);
    el(
      'div',
      'query-note query-note-dim',
      this.content,
      'Loops are inferred from file names only — not a real dependency graph.',
    );
    this.expand();
  }

  /** Idle view: live whole-map roster; refreshed on a slow timer, no per-frame DOM. */
  showRoster(): void {
    this.clearRoster();
    this.title.textContent = 'CITY ROSTER';
    const render = (): void => {
      const ctx = this.context;
      this.content.textContent = '';
      if (!ctx) {
        el('div', 'query-note', this.content, 'Found a city to inspect it.');
        return;
      }
      const byCategory = new Map<string, number>();
      for (const lot of ctx.layout.lots) {
        const cat = archetypeById(lot.archetypeId).category;
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
      }
      this.row('population', ctx.layout.stats.fileCount.toLocaleString());
      this.row('buildings', String(ctx.layout.lots.length));
      el('div', 'query-subhead', this.content, 'by category');
      for (const [cat, count] of [...byCategory.entries()].sort((p, q) => q[1] - p[1])) {
        this.row(cat, String(count));
      }
      const traffic = ctx.traffic;
      if (traffic) {
        el('div', 'query-subhead', this.content, `vehicles (${traffic.vehicleCount()} active)`);
        const counts = [...traffic.countsByType().entries()].sort((p, q) => q[1] - p[1]);
        for (const [typeId, count] of counts) this.row(typeId, String(count));
      }
      el(
        'div',
        'query-note query-note-dim',
        this.content,
        'Click a building or vehicle to inspect it.',
      );
    };
    render();
    this.rosterTimer = window.setInterval(() => {
      if (!this.open) return;
      render();
    }, 2000);
  }
}
