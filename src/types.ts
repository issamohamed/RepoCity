// Shared types for the Phase 1 world.

/** Tile coordinate on the demo map (integer tile units, origin at map corner). */
export interface TileCoord {
  tx: number;
  tz: number;
}

/** A node in the road routing graph — sits at an intersection or road end. */
export interface RoadNode {
  id: number;
  /** World-space position (y is road surface height). */
  x: number;
  z: number;
}

/** An undirected edge between two road nodes, with its length precomputed. */
export interface RoadEdge {
  a: number; // RoadNode id
  b: number; // RoadNode id
  length: number; // world units, precomputed at build time
}

/** The full routing graph produced by roads.ts; consumed by traffic in Phase 3. */
export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

/** One ingested file: path, size, nothing else. The HONESTY RULE boundary —
 * every visual downstream derives only from path, size, extension, or depth. */
export interface FileRecord {
  /** Forward-slash path relative to the scanned root, no leading slash. */
  path: string;
  /** Size in bytes (0 when the source can't provide one). */
  size: number;
}

export type SourceType = 'github' | 'local' | 'example';

/** The single ingestion contract; everything downstream consumes only this. */
export interface CitySource {
  files: FileRecord[];
  displayName: string;
  sourceType: SourceType;
  /** Branch name for GitHub sources. */
  branch?: string;
  /** "owner/repo" for GitHub sources (enables View-on-GitHub links later). */
  ownerRepo?: string;
  /** True when GitHub truncated the tree: we show the main districts only. */
  truncated: boolean;
}

/** Terrain classification per tile, used by terrain + tree scatter. */
export const TileKind = {
  Water: 0,
  Shore: 1,
  Beach: 2,
  Grass: 3,
  Dirt: 4,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];
