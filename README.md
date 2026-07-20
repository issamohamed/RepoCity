<img width="1327" height="741" alt="Screenshot 2026-07-20 at 1 20 23 PM" src="https://github.com/user-attachments/assets/8ea0b0e8-4b2a-433a-919e-3a859f4d588e" />


Repo City turns a GitHub repository, or a folder dragged straight off your desktop, into a pixel-art isometric city rendered in the browser. Directories become buildings. Files become traffic. Every fact the app shows you, a building's height, a vehicle's route, the population count, comes from the real shape of the codebase, never invented or embellished. Paste a repo, watch a city build itself in seconds, then click anything to see what it actually represents.

The whole thing is a loving homage to the isometric city-builders of the mid-1990s: a fixed camera angle, a deliberately low-resolution render upscaled with hard pixel edges, a chunky beveled interface. None of that borrows art or assets from any existing game. The rendering style is built entirely from scratch in code, so the nostalgia is real but the pixels are original.

## What actually happens when you scan a repo

The app fetches the repository's file tree (or reads a locally dropped folder without ever uploading its contents) and lays out a coastal, isometric map sized to match the codebase, larger repositories genuinely produce larger cities. Each directory is assigned one of roughly sixty distinct building archetypes based on its real name, role, and size: a `test` folder becomes something industrial, a `docs` folder becomes something civic, a folder full of API routes becomes a post office. The skyline is deliberately varied rather than repetitive, so a large monorepo reads as an actual downtown instead of rows of identical towers.

Roads connect every district, wrapping around organically shaped coastlines and interior ponds, occasionally crossing water by bridge when routing around it would be unreasonable. Traffic moves through all of it: every vehicle on the road is bound to a real file, following a route between its home building and wherever it seems to relate to. Click a building or a vehicle and a panel tells you exactly what it is, no fabricated detail, ever.

There's also a Builder's Mode, an explicitly separate sandbox where you can place any of the ~60 building types by hand from a categorized palette. It's walled off from the honest, data-driven view on purpose, wrapped in unmistakable visual chrome, so a hand-built city and a real scanned one can never be confused for each other.

## Running it locally

```
git clone https://github.com/issamohamed/RepoCity.git
cd RepoCity
npm install
npm run dev
```

That starts a local dev server. Open it, hit Play, and either paste a public repository (`owner/repo` or a full GitHub URL) or drag a local folder onto the page. There's also a built-in "Try an example" button that founds a synthetic test city exercising every building type at once, useful for browsing the full archetype set without needing a real repo on hand.

To build a production bundle:

```
npm run build
```

The output is a fully static site, no server, no database, no API keys required. It deploys cleanly to any static host; this project is set up for Cloudflare Pages.

## Design constraints, on purpose

Everything in Repo City is free to run: no paid APIs, no backend, no external assets or fonts beyond what ships in the repo. GitHub scanning uses the public, unauthenticated API, which is rate-limited but requires no account. Local folders never leave the browser; only file names and sizes are read, never contents.

The project is built in strict TypeScript on top of three.js and Vite, with no game engine and no UI framework, everything from the rendering pipeline to the interface chrome is hand-built. A three-part consistency check runs against every generated city (the road network stays fully connected, nothing dead-ends, every building's door touches a street) so the underlying layout logic stays honest as the codebase grows.

## Why it looks the way it looks

The retro rendering is the actual engineering core of the project, not a filter applied on top. The scene renders internally at a low, fixed resolution and gets upscaled with hard pixel edges, paired with a fixed four-angle camera and a restrained color treatment, which is what produces the specific, slightly crunchy 1990s software-rendered look rather than a generic "pixel art" filter. Every building, vehicle, and terrain feature inherits that look automatically, since the pipeline does the work once instead of every asset needing to fake it individually.

## A note on honesty

Nothing in Repo City's generated view is decorative in a way that misrepresents the underlying repository. Population counts are never inflated or floored. A vehicle's route is a best-effort guess based on file naming, and the interface says so plainly rather than implying real dependency analysis that isn't happening. If a repository is small, its city is small and charming rather than artificially padded; if it's enormous, the map grows to match, and any visual filler used to keep a giant, sparse codebase looking full is kept strictly separate from the numbers that describe it.

---

Repo City is an independent project and is not affiliated with, endorsed by, or associated with any commercial city-building game. All visual assets are original.
