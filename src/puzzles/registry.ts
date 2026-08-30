import { TOP_LAYER_EDGES, TOP_LAYER_EDGES_ID } from "./topLayerEdges";
import type { PuzzleDefinition } from "./types";

export const PUZZLE_REGISTRY = Object.freeze({
  [TOP_LAYER_EDGES_ID]: TOP_LAYER_EDGES,
});

export type RegisteredPuzzleId = keyof typeof PUZZLE_REGISTRY;
export type RegisteredPuzzleDefinition =
  (typeof PUZZLE_REGISTRY)[RegisteredPuzzleId];

/**
 * Type-erased view used only after `isState` succeeds at a runtime boundary.
 * This lets the worker dispatch heterogeneous future puzzle definitions without
 * hard-coding their state or move unions into its protocol.
 */
export type RuntimePuzzleDefinition = PuzzleDefinition<unknown, string>;

export const isRegisteredPuzzleId = (
  value: unknown,
): value is RegisteredPuzzleId =>
  typeof value === "string" && Object.hasOwn(PUZZLE_REGISTRY, value);

export function getPuzzleDefinition<Id extends RegisteredPuzzleId>(
  id: Id,
): (typeof PUZZLE_REGISTRY)[Id];
export function getPuzzleDefinition(
  id: string,
): RuntimePuzzleDefinition | undefined;
export function getPuzzleDefinition(
  id: string,
): RegisteredPuzzleDefinition | RuntimePuzzleDefinition | undefined {
  return isRegisteredPuzzleId(id)
    ? (PUZZLE_REGISTRY[id] as unknown as RuntimePuzzleDefinition)
    : undefined;
}
