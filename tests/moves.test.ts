import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyWord,
  formatState,
  SOLVED_STATE,
} from "../src/core/moves";
import type { EdgeState } from "../src/core/types";

describe("moves", () => {
  it("applies F exactly as defined", () => {
    const state: EdgeState = [
      { id: 1, flipped: false },
      { id: 3, flipped: true },
      { id: 5, flipped: false },
      { id: 4, flipped: false },
      { id: 2, flipped: false },
    ];
    const next = applyMove(state, "F");
    expect(formatState(next)).toBe("[3, 5, 1', 4, 2]");
  });

  it("applies S as one right rotation", () => {
    const next = applyMove(SOLVED_STATE, "S");
    expect(formatState(next)).toBe("[5, 1, 2, 3, 4]");
  });

  it("applies S' as one left rotation", () => {
    const next = applyMove(SOLVED_STATE, "S'");
    expect(formatState(next)).toBe("[2, 3, 4, 5, 1]");
  });

  it("applies F' as inverse of F", () => {
    const state: EdgeState = [
      { id: 1, flipped: false },
      { id: 3, flipped: true },
      { id: 5, flipped: false },
      { id: 4, flipped: false },
      { id: 2, flipped: false },
    ];
    const transformed = applyMove(state, "F");
    const restored = applyMove(transformed, "F'");
    expect(formatState(restored)).toBe(formatState(state));
  });

  it("matches the requested S/S' equivalences", () => {
    const s3 = applyWord(SOLVED_STATE, ["S", "S", "S"]);
    const sinv2 = applyWord(SOLVED_STATE, ["S'", "S'"]);
    const s4 = applyWord(SOLVED_STATE, ["S", "S", "S", "S"]);
    const sinv = applyWord(SOLVED_STATE, ["S'"]);
    expect(formatState(s3)).toBe(formatState(sinv2));
    expect(formatState(s4)).toBe(formatState(sinv));
  });

  it("matches F' = FF for this top-layer action", () => {
    const sample = applyWord(SOLVED_STATE, ["S", "F", "S"]);
    const finv = applyMove(sample, "F'");
    const f2 = applyWord(sample, ["F", "F"]);
    expect(formatState(finv)).toBe(formatState(f2));
  });

  it("applies words in-order", () => {
    const next = applyWord(SOLVED_STATE, ["S", "F"]);
    expect(formatState(next)).toBe("[1', 2, 5', 3, 4]");
  });
});
