import type { MoveSpec } from "../puzzles/types";
import type { Edge, EdgeId, EdgeState, Move } from "./types";

const EDGE_IDS = new Set<number>([1, 2, 3, 4, 5]);

const freezeEdge = (edge: Edge): Edge =>
  Object.freeze({ id: edge.id, flipped: edge.flipped });

const freezeState = (edges: readonly Edge[]): EdgeState => {
  if (edges.length !== 5) {
    throw new TypeError("An edge state must contain exactly five positions.");
  }
  return Object.freeze(edges.map(freezeEdge)) as unknown as EdgeState;
};

export const isEdgeState = (value: unknown): value is EdgeState => {
  if (!Array.isArray(value) || value.length !== 5) {
    return false;
  }

  const ids = new Set<number>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const edge = candidate as { id?: unknown; flipped?: unknown };
    if (
      typeof edge.id !== "number" ||
      !Number.isInteger(edge.id) ||
      !EDGE_IDS.has(edge.id) ||
      typeof edge.flipped !== "boolean" ||
      ids.has(edge.id)
    ) {
      return false;
    }
    ids.add(edge.id);
  }
  return ids.size === 5;
};

export const assertEdgeState: (value: unknown) => asserts value is EdgeState = (
  value,
) => {
  if (!isEdgeState(value)) {
    throw new TypeError(
      "Invalid edge state: expected five unique edge ids 1..5 with boolean flipped values.",
    );
  }
};

export const MOVE_SPECS = Object.freeze([
  Object.freeze({ notation: "F", inverse: "F'", label: "Front clockwise" }),
  Object.freeze({
    notation: "F'",
    inverse: "F",
    label: "Front counter-clockwise",
  }),
  Object.freeze({ notation: "S", inverse: "S'", label: "Top ring clockwise" }),
  Object.freeze({
    notation: "S'",
    inverse: "S",
    label: "Top ring counter-clockwise",
  }),
] as const satisfies readonly MoveSpec<Move>[]);

/** Canonical move/search/scramble order. */
export const MOVES: readonly Move[] = Object.freeze(
  MOVE_SPECS.map((spec) => spec.notation),
);

const moveSpecByNotation = new Map<Move, MoveSpec<Move>>(
  MOVE_SPECS.map((spec) => [spec.notation, spec]),
);

export const isMove = (value: unknown): value is Move =>
  typeof value === "string" && moveSpecByNotation.has(value as Move);

export const getMoveSpec = (move: Move): MoveSpec<Move> => {
  const spec = moveSpecByNotation.get(move);
  if (!spec) {
    throw new TypeError(`Unknown move notation: ${String(move)}`);
  }
  return spec;
};

export const inverseMove = (move: Move): Move => getMoveSpec(move).inverse;

export const SOLVED_STATE: EdgeState = freezeState([
  { id: 1, flipped: false },
  { id: 2, flipped: false },
  { id: 3, flipped: false },
  { id: 4, flipped: false },
  { id: 5, flipped: false },
]);

export const cloneState = (state: EdgeState): EdgeState => {
  assertEdgeState(state);
  return freezeState(state);
};

export const formatEdge = (edge: Edge): string =>
  edge.flipped ? `${edge.id}'` : `${edge.id}`;

export const formatState = (state: EdgeState): string => {
  assertEdgeState(state);
  return `[${state.map((edge) => formatEdge(edge)).join(", ")}]`;
};

const cloneEdge = (edge: Edge): Edge => ({
  id: edge.id,
  flipped: edge.flipped,
});
const flip = (edge: Edge): Edge => ({ id: edge.id, flipped: !edge.flipped });

export const applyMove = (state: EdgeState, move: Move): EdgeState => {
  assertEdgeState(state);
  if (!isMove(move)) {
    throw new TypeError(`Unknown move notation: ${String(move)}`);
  }

  const [a, b, c, d, e] = state;
  switch (move) {
    case "F":
      // F: [a,b,c,d,e] -> [b', c, a', d, e]
      return freezeState([
        flip(b),
        cloneEdge(c),
        flip(a),
        cloneEdge(d),
        cloneEdge(e),
      ]);
    case "F'":
      // F': [a,b,c,d,e] -> [c', a', b, d, e]
      return freezeState([
        flip(c),
        flip(a),
        cloneEdge(b),
        cloneEdge(d),
        cloneEdge(e),
      ]);
    case "S":
      // S: [a,b,c,d,e] -> [e,a,b,c,d]
      return freezeState([
        cloneEdge(e),
        cloneEdge(a),
        cloneEdge(b),
        cloneEdge(c),
        cloneEdge(d),
      ]);
    case "S'":
      // S': [a,b,c,d,e] -> [b,c,d,e,a]
      return freezeState([
        cloneEdge(b),
        cloneEdge(c),
        cloneEdge(d),
        cloneEdge(e),
        cloneEdge(a),
      ]);
  }
};

export const applyWord = (
  state: EdgeState,
  word: readonly Move[],
): EdgeState => {
  assertEdgeState(state);
  return word.reduce(
    (current, move) => applyMove(current, move),
    cloneState(state),
  );
};

export const serialize = (state: EdgeState): string => {
  assertEdgeState(state);
  return state.map((edge) => `${edge.id}${edge.flipped ? "p" : "n"}`).join("|");
};

export const edgeIdFromNumber = (value: number): EdgeId | null =>
  EDGE_IDS.has(value) ? (value as EdgeId) : null;
