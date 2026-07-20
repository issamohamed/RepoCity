// --- Home screen -------------------------------------------------------------------
// Full-screen title view shown before any city exists: title, PLAY, ABOUT.
// PLAY leads to a two-way choice: "Upload a City" (the normal scan/drop flow)
// or "Build a City" (Builder's Mode — straight into Edit Mode on an empty
// island). Pure DOM chrome in the same era styling as the rest of the app.

export interface HomeCallbacks {
  /** "Upload a City": reveal the normal scan/drop screen. */
  onUpload: () => void;
  /** "Build a City": jump straight into Builder's Mode on an empty island. */
  onBuilder: () => void;
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

// Original 5×7 bitmap glyphs for the title wordmark — drawn by hand, no
// external font. Rendered on a tiny canvas and upscaled nearest-neighbor.
const TITLE_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

/** Classic beveled logo shading: lighter crown, darker base, per pixel row. */
const TITLE_ROW_COLORS = [
  '#ffffff',
  '#ffffff',
  '#f2f2f2',
  '#f2f2f2',
  '#f2f2f2',
  '#c8c8c8',
  '#c8c8c8',
] as const;

/** Title materialize/dissolve loop timings, seconds. */
const TITLE_CYCLE = { assemble: 1.3, hold: 2.8, dissolve: 1.0, gap: 0.45 } as const;

const ABOUT_COPY: [string, string][] = [
  [
    'What is this?',
    'Repo City turns a codebase into a little pixel-art city, in the style of ' +
      'the classic mid-90s city builders.',
  ],
  [
    'Upload a City',
    'Point it at any public GitHub repository — or drag a folder straight in. ' +
      'Folders never leave your browser; only file names and sizes are read. ' +
      'Every folder becomes a building, sized by the real files inside it, and ' +
      'the files themselves become the cars, buses, and trucks driving around town.',
  ],
  [
    'Everything is true',
    'Click any building or vehicle and the inspector shows the real numbers ' +
      'behind it — actual names, file counts, and sizes from the code. Nothing ' +
      'on the map is invented.',
  ],
  [
    'Build a City',
    "Builder's Mode hands you an empty island and the full building catalog — " +
      'place towers, parks, roads, and bridges wherever you like. Your own ' +
      'creations are always labeled as yours, kept separate from the real data.',
  ],
];

export class HomeScreen {
  private readonly root: HTMLElement;
  private readonly playView: HTMLElement;
  private readonly modesView: HTMLElement;
  private readonly aboutPanel: HTMLElement;

  constructor(cb: HomeCallbacks) {
    this.root = el('div', 'home-screen', document.body);

    const aboutBtn = el('button', 'hud-btn home-about-btn', this.root, 'ABOUT');
    aboutBtn.addEventListener('click', () => this.showAbout(true));

    const center = el('div', 'home-center', this.root);
    const title = el('h1', 'home-title', center);
    title.setAttribute('aria-label', 'REPO CITY');
    const titleCanvas = document.createElement('canvas');
    titleCanvas.className = 'home-title-px';
    title.appendChild(titleCanvas);
    this.startTitleLoop(titleCanvas, 'REPO CITY');
    el('div', 'home-sub', center, 'your codebase, alive and simulated in real time');

    this.playView = el('div', 'home-view', center);
    const playBtn = el('button', 'home-play', this.playView, '▶  PLAY');
    playBtn.addEventListener('click', () => this.showModes(true));

    this.modesView = el('div', 'home-view home-modes', center);
    this.modesView.style.display = 'none';
    const row = el('div', 'home-mode-row', this.modesView);
    const uploadBtn = el('button', 'home-mode-btn', row);
    el('div', 'home-mode-name', uploadBtn, 'UPLOAD A CITY');
    el('div', 'home-mode-desc', uploadBtn, 'scan a repo or drop a folder — see it as a city');
    uploadBtn.addEventListener('click', () => {
      this.hide();
      cb.onUpload();
    });
    const buildBtn = el('button', 'home-mode-btn', row);
    el('div', 'home-mode-name', buildBtn, 'BUILD A CITY');
    el(
      'div',
      'home-mode-desc',
      buildBtn,
      "builder's mode — an empty island and the full catalog",
    );
    buildBtn.addEventListener('click', () => {
      this.hide();
      cb.onBuilder();
    });
    const backBtn = el('button', 'hud-btn hud-btn-quiet home-back', this.modesView, '← back');
    backBtn.addEventListener('click', () => this.showModes(false));

    this.aboutPanel = el('div', 'home-about-panel', this.root);
    this.aboutPanel.style.display = 'none';
    const chrome = el('div', 'query-chrome home-about-chrome', this.aboutPanel);
    const header = el('div', 'query-header', chrome);
    el('span', 'query-title', header, 'ABOUT REPO CITY');
    const closeBtn = el('button', 'query-close', header, '×');
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', () => this.showAbout(false));
    const body = el('div', 'query-content', chrome);
    for (const [head, text] of ABOUT_COPY) {
      el('div', 'query-subhead', body, head);
      el('div', 'query-note', body, text);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isVisible()) return;
      if (this.aboutPanel.style.display !== 'none') this.showAbout(false);
      else this.showModes(false);
    });
  }

  /**
   * Wordmark loop: the title's pixels materialize in random order, hold, then
   * dissolve away, forever. Drawn from the hand-made bitmap glyphs above on a
   * tiny canvas upscaled nearest-neighbor, so it stays true pixel art. With
   * prefers-reduced-motion the title simply renders complete and stays.
   */
  private startTitleLoop(canvas: HTMLCanvasElement, text: string): void {
    // Lay the glyphs out on the logical pixel grid (1 unit = 1 fat pixel).
    const pixels: { x: number; y: number; row: number }[] = [];
    let cursor = 0;
    for (const ch of text) {
      const glyph = TITLE_GLYPHS[ch];
      if (!glyph) continue;
      glyph.forEach((rowBits, row) => {
        for (let col = 0; col < rowBits.length; col++) {
          if (rowBits[col] === '1') pixels.push({ x: cursor + col, y: row, row });
        }
      });
      cursor += (glyph[0]?.length ?? 0) + 1;
    }
    canvas.width = cursor; // includes 1px trailing gap → shadow room
    canvas.height = 8; // 7 glyph rows + 1 for the drop shadow
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = (count: number): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < count; i++) {
        const p = pixels[i];
        if (!p) break;
        ctx.fillStyle = '#141412';
        ctx.fillRect(p.x + 1, p.y + 1, 1, 1); // drop shadow first
      }
      for (let i = 0; i < count; i++) {
        const p = pixels[i];
        if (!p) break;
        ctx.fillStyle = TITLE_ROW_COLORS[p.row] ?? '#f2d33d';
        ctx.fillRect(p.x, p.y, 1, 1);
      }
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(pixels.length);
      return;
    }
    // Shuffle once so pixels materialize in a stable random sprinkle.
    for (let i = pixels.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = pixels[i];
      const b = pixels[j];
      if (a && b) {
        pixels[i] = b;
        pixels[j] = a;
      }
    }
    const c = TITLE_CYCLE;
    const cycleLen = c.assemble + c.hold + c.dissolve + c.gap;
    const t0 = performance.now();
    let lastCount = -1;
    const tick = (now: number): void => {
      if (this.isVisible()) {
        const t = ((now - t0) / 1000) % cycleLen;
        let count: number;
        if (t < c.assemble) {
          count = Math.round((t / c.assemble) * pixels.length);
        } else if (t < c.assemble + c.hold) {
          count = pixels.length;
        } else if (t < c.assemble + c.hold + c.dissolve) {
          const d = (t - c.assemble - c.hold) / c.dissolve;
          count = Math.round((1 - d) * pixels.length);
        } else {
          count = 0;
        }
        if (count !== lastCount) {
          lastCount = count;
          draw(count);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private showAbout(on: boolean): void {
    this.aboutPanel.style.display = on ? 'flex' : 'none';
  }

  private showModes(on: boolean): void {
    this.playView.style.display = on ? 'none' : 'block';
    this.modesView.style.display = on ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(): void {
    this.root.style.display = 'flex';
    document.body.classList.add('home-active');
    this.showModes(false);
    this.showAbout(false);
  }

  hide(): void {
    this.root.style.display = 'none';
    document.body.classList.remove('home-active');
  }
}
