import { describe, expect, it } from "vitest";
import { applyWord, SOLVED_STATE } from "../src/core/moves";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";
import {
  decodeSessionHash,
  encodeSessionHash,
} from "../src/services/url-session";

describe("versioned URL sessions", () => {
  it("encodes the documented stable fragment schema", () => {
    expect(
      encodeSessionHash(TOP_LAYER_EDGES, SOLVED_STATE, {
        word: ["F", "S'"],
        seed: " demo ",
        scrambleLength: 14,
      }),
    ).toBe(
      "#v=1&p=top-layer-edges&state=1n%7C2n%7C3n%7C4n%7C5n&word=F%20S%27&seed=demo&len=14",
    );
  });

  it("round-trips state and paused workspace inputs", () => {
    const state = applyWord(SOLVED_STATE, ["S", "F"]);
    const hash = encodeSessionHash(TOP_LAYER_EDGES, state, {
      word: ["F'", "S"],
      seed: "lab-notes",
      scrambleLength: 23,
    });
    const decoded = decodeSessionHash(hash, TOP_LAYER_EDGES);

    expect(decoded.hasSession).toBe(true);
    expect(decoded.warnings).toEqual([]);
    expect(TOP_LAYER_EDGES.serialize(decoded.state)).toBe(
      TOP_LAYER_EDGES.serialize(state),
    );
    expect(decoded.word).toEqual(["F'", "S"]);
    expect(decoded.wordText).toBe("F' S");
    expect(decoded.seed).toBe("lab-notes");
    expect(decoded.scrambleLength).toBe(23);
    expect(decoded).not.toHaveProperty("autoplay");
    expect(decoded).not.toHaveProperty("history");
    expect(decoded).not.toHaveProperty("camera");
  });

  it("drops an invalid optional word without losing a valid state", () => {
    const state = applyWord(SOLVED_STATE, ["S"]);
    const hash = `#v=1&p=top-layer-edges&state=${encodeURIComponent(
      TOP_LAYER_EDGES.serialize(state),
    )}&word=F%20X&seed=demo&len=8`;
    const decoded = decodeSessionHash(hash, TOP_LAYER_EDGES);

    expect(TOP_LAYER_EDGES.serialize(decoded.state)).toBe(
      TOP_LAYER_EDGES.serialize(state),
    );
    expect(decoded.word).toEqual([]);
    expect(decoded.wordText).toBe("");
    expect(decoded.seed).toBe("demo");
    expect(decoded.scrambleLength).toBe(8);
    expect(decoded.warnings).toEqual([
      expect.objectContaining({ code: "invalid-word", field: "word" }),
    ]);
  });

  it("falls back to solved on an invalid required state while retaining valid optional inputs", () => {
    const decoded = decodeSessionHash(
      "#v=1&p=top-layer-edges&state=not-a-state&word=F&seed=demo&len=9",
      TOP_LAYER_EDGES,
    );

    expect(TOP_LAYER_EDGES.serialize(decoded.state)).toBe(
      TOP_LAYER_EDGES.serialize(SOLVED_STATE),
    );
    expect(decoded.word).toEqual(["F"]);
    expect(decoded.seed).toBe("demo");
    expect(decoded.scrambleLength).toBe(9);
    expect(decoded.warnings).toEqual([
      expect.objectContaining({ code: "invalid-state", field: "state" }),
    ]);
  });

  it("loads safe defaults and warnings for malformed required fields", () => {
    const wrongVersion = decodeSessionHash(
      "#v=99&p=top-layer-edges&state=1n%7C2n%7C3n%7C4n%7C5n",
      TOP_LAYER_EDGES,
    );
    expect(wrongVersion.warnings).toEqual([
      expect.objectContaining({ code: "unsupported-version", field: "v" }),
    ]);

    const wrongPuzzle = decodeSessionHash(
      "#v=1&p=full-megaminx&state=1n%7C2n%7C3n%7C4n%7C5n",
      TOP_LAYER_EDGES,
    );
    expect(wrongPuzzle.warnings).toEqual([
      expect.objectContaining({ code: "puzzle-mismatch", field: "p" }),
    ]);

    const missingVersion = decodeSessionHash(
      "#p=top-layer-edges",
      TOP_LAYER_EDGES,
    );
    expect(missingVersion.warnings).toEqual([
      expect.objectContaining({ code: "missing-field", field: "v" }),
    ]);
  });

  it("ignores unrecognized stateful UI parameters and rejects duplicate known fields", () => {
    const extra = decodeSessionHash(
      "#v=1&p=top-layer-edges&state=1n%7C2n%7C3n%7C4n%7C5n&autoplay=1&camera=secret",
      TOP_LAYER_EDGES,
    );
    expect(extra.warnings).toEqual([]);

    const duplicateWord = decodeSessionHash(
      "#v=1&p=top-layer-edges&state=1n%7C2n%7C3n%7C4n%7C5n&word=F&word=S",
      TOP_LAYER_EDGES,
    );
    expect(duplicateWord.word).toEqual([]);
    expect(duplicateWord.warnings).toEqual([
      expect.objectContaining({ code: "duplicate-field", field: "word" }),
    ]);
  });

  it("treats an empty fragment as a clean solved session", () => {
    const decoded = decodeSessionHash("", TOP_LAYER_EDGES);
    expect(decoded.hasSession).toBe(false);
    expect(decoded.warnings).toEqual([]);
    expect(decoded.scrambleLength).toBe(14);
    expect(TOP_LAYER_EDGES.serialize(decoded.state)).toBe(
      TOP_LAYER_EDGES.serialize(SOLVED_STATE),
    );
  });

  it("refuses to encode invalid optional inputs", () => {
    expect(() =>
      encodeSessionHash(TOP_LAYER_EDGES, SOLVED_STATE, { seed: "   " }),
    ).toThrow(RangeError);
    expect(() =>
      encodeSessionHash(TOP_LAYER_EDGES, SOLVED_STATE, { scrambleLength: 51 }),
    ).toThrow(RangeError);
    expect(() =>
      encodeSessionHash(TOP_LAYER_EDGES, SOLVED_STATE, {
        word: Array.from({ length: 201 }, () => "F"),
      }),
    ).toThrow(RangeError);
  });
});
