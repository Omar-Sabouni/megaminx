export type EdgeId = 1 | 2 | 3 | 4 | 5;

export interface Edge {
  readonly id: EdgeId;
  readonly flipped: boolean;
}

export type EdgeState = readonly [Edge, Edge, Edge, Edge, Edge];

export type Move = "F" | "F'" | "S" | "S'";

export interface SolveSuccess {
  reachable: true;
  word: readonly Move[];
  depth: number;
}

export interface SolveFailure {
  reachable: false;
  reason: string;
}

export type SolveResult = SolveSuccess | SolveFailure;

export interface BfsTreeNode {
  key: string;
  depth: number;
  parentKey: string | null;
  moveFromParent: Move | null;
  stateLabel: string;
}

export interface BfsTreeLayer {
  depth: number;
  count: number;
  renderedCount: number;
}

export interface BfsParentLink {
  prev: string | null;
  move: Move | null;
}

export interface BfsTreeResult {
  rootKey: string;
  maxRenderedDepth: number;
  hasDeeperNodes: boolean;
  deeperNodeCount: number;
  totalVisited: number;
  nodes: BfsTreeNode[];
  layers: BfsTreeLayer[];
  depthByKey: Record<string, number>;
  parentByKey: Record<string, BfsParentLink>;
  stateLabelByKey: Record<string, string>;
  currentKey: string;
  currentDepth: number | null;
  currentInComponent: boolean;
  renderedAncestorKey: string | null;
  pathToCurrent: string[];
}
