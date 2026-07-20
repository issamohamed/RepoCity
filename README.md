# Repo City

A static web app that renders GitHub repos and local folders as pixel-art
isometric cities in the style of mid-90s city builders. Original assets only;
every visual derives from honest data: file paths, sizes, extensions, and
directory depth. The free GitHub tree API has no history or contents, and the
app never pretends otherwise.

## Run

```sh
npm install
npm run dev
```

- Type `owner/repo` (or a GitHub URL) and SCAN, or drag a folder onto the page.
- Type `metropolis` for the built-in kitchen-sink demo city that exercises
  every building archetype at once.
- `?showcase=1` renders one instance of every archetype in a review grid.
- Controls: Q/E rotate · +/− zoom · arrows or screen edges pan ·
  G routing-graph overlay · B retro/modern render bypass · click a building
  or vehicle to inspect it (Esc collapses the inspector) · ⏸ ▶ ⏩ gate the
  traffic clock.
- Traffic honesty: each vehicle is a real file; loops between buildings are
  inferred from file names only (documented in `src/trafficstops.ts`) and the
  inspector words them as "likely", never as analyzed dependencies.

## Honesty rules

- The HUD population is always the true file count — never floored, never
  inflated.
- Buildings map to real directories (and, for small flat repos, real files)
  via documented match rules in `src/archetypes.ts`.
- Civic amenities (diner, cathedral, parks…) are the one decorative layer:
  their count derives only from island size and true file count
  (`LAYOUT_CONFIG` density floor), they carry generic signs, and they are
  never presented as directories.

## Future ideas

- **Interior lakes + bridges**: scatter 1–3 small hash-deterministic lakes on
  larger islands, with simple original bridge decks where roads cross them.
  Deferred deliberately: roads currently never cross water, and carving lakes
  through district interiors touches the terrain classifier, lot placement,
  and the routing-graph gate that Phase 2B traffic depends on. Attempt after
  traffic is stable.
- Era chrome UI, left toolbar, minimap, Planning Report window (Phase 3).
