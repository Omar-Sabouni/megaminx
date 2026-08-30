import { invariantComponentKey } from "../core/invariants";
import {
  applyMove,
  cloneState,
  formatState,
  isEdgeState,
  MOVE_SPECS,
  serialize,
  SOLVED_STATE,
} from "../core/moves";
import { parseSerializedState, parseTuple } from "../core/parser";
import type { EdgeState, Move } from "../core/types";
import type { PuzzleDefinition } from "./types";

export const TOP_LAYER_EDGES_ID = "top-layer-edges" as const;

/** Versioned five-edge F/S model used by the current application. */
export const TOP_LAYER_EDGES: PuzzleDefinition<EdgeState, Move> = Object.freeze(
  {
    id: TOP_LAYER_EDGES_ID,
    version: 1,
    label: "Megaminx top-layer edges",
    moves: MOVE_SPECS,
    solvedState: SOLVED_STATE,
    isState: isEdgeState,
    cloneState,
    serialize,
    deserialize: parseSerializedState,
    formatState,
    parseState: parseTuple,
    applyMove,
    componentKey: invariantComponentKey,
  },
);

/** Compatibility/name-style alias for consumers that prefer camel case. */
export const topLayerEdges = TOP_LAYER_EDGES;
