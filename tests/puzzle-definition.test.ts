import { describe, expect, it } from "vitest";
import { isEdgeState, MOVE_SPECS } from "../src/core/moves";
import { parseSerializedState, parseTuple } from "../src/core/parser";
import {
  SOLVED_ORBIT_SIZE,
  validateReachableInput,
} from "../src/core/reachability";
import { getPuzzleDefinition } from "../src/puzzles/registry";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

describe("top-layer puzzle definition", () => {
  it("is registered and exposes canonical inverse metadata", () => {
    expect(getPuzzleDefinition("top-layer-edges")).toBe(TOP_LAYER_EDGES);
    expect(getPuzzleDefinition("unknown")).toBeUndefined();
    for (const spec of MOVE_SPECS) {
      const inverse = MOVE_SPECS.find(
        (candidate) => candidate.notation === spec.inverse,
      );
      expect(inverse?.inverse).toBe(spec.notation);
    }
  });

  it("produces readonly, runtime-valid states", () => {
    expect(isEdgeState(TOP_LAYER_EDGES.solvedState)).toBe(true);
    expect(Object.isFrozen(TOP_LAYER_EDGES.solvedState)).toBe(true);
    expect(TOP_LAYER_EDGES.solvedState.every(Object.isFrozen)).toBe(true);
    expect(isEdgeState([{ id: 1, flipped: false }])).toBe(false);
    expect(
      isEdgeState([
        { id: 1, flipped: false },
        { id: 1, flipped: false },
        { id: 3, flipped: false },
        { id: 4, flipped: false },
        { id: 5, flipped: false },
      ]),
    ).toBe(false);
  });

  it("round-trips the stable serialized form", () => {
    const parsed = parseSerializedState("3p|1n|5p|2n|4n");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(TOP_LAYER_EDGES.serialize(parsed.value)).toBe("3p|1n|5p|2n|4n");
    }
    expect(parseSerializedState("1n|2n|3n|4n|4p").ok).toBe(false);
  });

  it("parses structurally valid states outside the solved component", () => {
    const parsed = parseTuple("[1', 2, 3, 4, 5]");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(validateReachableInput(parsed.value).ok).toBe(false);
    }
    expect(SOLVED_ORBIT_SIZE).toBe(960);
  });

  it("rejects empty tokens, trailing commas, and mismatched brackets", () => {
    expect(parseTuple("1,2,,4,5").ok).toBe(false);
    expect(parseTuple("1,2,3,4,5,").ok).toBe(false);
    expect(parseTuple("[1,2,3,4,5").ok).toBe(false);
    expect(parseTuple("1,2,3,4,5]").ok).toBe(false);
  });
});
