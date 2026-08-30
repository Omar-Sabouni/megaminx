import { describe, expect, it } from "vitest";
import { parseTuple, stateToInputString } from "../src/core/parser";

describe("parser", () => {
  it("parses apostrophe notation", () => {
    const result = parseTuple("1, 3', 5, 4, 2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(stateToInputString(result.state)).toBe("[1, 3', 5, 4, 2]");
    }
  });

  it("rejects duplicate ids", () => {
    const result = parseTuple("1, 2, 2, 4, 5");
    expect(result.ok).toBe(false);
  });

  it("rejects malformed tokens", () => {
    const result = parseTuple("1, 2, 3x, 4, 5");
    expect(result.ok).toBe(false);
  });
});
