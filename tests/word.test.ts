import { describe, expect, it } from "vitest";
import { SOLVED_STATE } from "../src/core/moves";
import {
  MAX_WORD_LENGTH,
  applyWordToState,
  parseWord,
  previewWord,
} from "../src/core/word";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

describe("word analysis", () => {
  it("treats an empty editor as the identity word", () => {
    expect(parseWord(" \n\t ", TOP_LAYER_EDGES)).toEqual({
      ok: true,
      value: { moves: [], normalized: "" },
    });
  });

  it("accepts mixed whitespace and comma separators and normalizes notation", () => {
    expect(parseWord(" F,  S'\nS   F' ", TOP_LAYER_EDGES)).toEqual({
      ok: true,
      value: { moves: ["F", "S'", "S", "F'"], normalized: "F S' S F'" },
    });
  });

  it("reports the exact unregistered token and its position", () => {
    const result = parseWord("F S2 S", TOP_LAYER_EDGES);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "unknown-move",
        message: "Move 2 (\"S2\") is not registered. Use one of: F, F', S, S'.",
        tokenIndex: 1,
        token: "S2",
      },
    });
  });

  it("rejects missing comma-separated tokens", () => {
    const result = parseWord("F,,S", TOP_LAYER_EDGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "empty-token",
        tokenIndex: 1,
        token: "",
      });
    }
  });

  it("enforces the 200-move input cap", () => {
    const atLimit = Array.from({ length: MAX_WORD_LENGTH }, () => "F").join(
      " ",
    );
    const overLimit = `${atLimit} F`;

    expect(parseWord(atLimit, TOP_LAYER_EDGES).ok).toBe(true);
    const result = parseWord(overLimit, TOP_LAYER_EDGES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("too-long");
    }
  });

  it("previews and applies words without mutating the input state", () => {
    const before = TOP_LAYER_EDGES.serialize(SOLVED_STATE);
    const preview = previewWord("S F", TOP_LAYER_EDGES, SOLVED_STATE);

    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(TOP_LAYER_EDGES.formatState(preview.value.state)).toBe(
        "[1', 2, 5', 3, 4]",
      );
      expect(preview.value.state).toEqual(
        applyWordToState(TOP_LAYER_EDGES, SOLVED_STATE, ["S", "F"]),
      );
    }
    expect(TOP_LAYER_EDGES.serialize(SOLVED_STATE)).toBe(before);
  });
});
