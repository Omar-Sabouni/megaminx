import { describe, expect, it } from "vitest";
import { applyWord, serialize, SOLVED_STATE } from "../src/core/moves";
import { validateReachableInput } from "../src/core/reachability";
import { findShortestWord } from "../src/core/solver-bfs";
import type { EdgeState } from "../src/core/types";

describe("solver", () => {
  it("returns a shortest word from a reachable start", () => {
    const scrambleWord = ["S", "F", "S", "S", "F"] as const;
    const start = applyWord(SOLVED_STATE, scrambleWord);
    const result = findShortestWord(start, SOLVED_STATE);
    expect(result.reachable).toBe(true);
    if (result.reachable) {
      const end = applyWord(start, result.word);
      expect(serialize(end)).toBe(serialize(SOLVED_STATE));
    }
  });

  it("reports unreachable when parity blocks path", () => {
    const unreachable: EdgeState = [
      { id: 1, flipped: true },
      { id: 2, flipped: false },
      { id: 3, flipped: false },
      { id: 4, flipped: false },
      { id: 5, flipped: false },
    ];
    const validation = validateReachableInput(unreachable);
    expect(validation.ok).toBe(false);

    const result = findShortestWord(unreachable, SOLVED_STATE);
    expect(result.reachable).toBe(false);
  });
});
