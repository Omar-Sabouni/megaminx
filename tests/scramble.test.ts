import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRAMBLE_LENGTH,
  fnv1a32,
  generateScramble,
  normalizeScrambleSeed,
  parseScrambleLength,
} from "../src/core/scramble";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

describe("seeded scrambles", () => {
  it("uses stable UTF-8 FNV-1a hashing", () => {
    expect(fnv1a32("hello")).toBe(0x4f9f2cab);
    expect(fnv1a32("é")).toBe(513_665_217);
  });

  it("normalizes a trimmed NFKC seed and validates its size", () => {
    expect(normalizeScrambleSeed("  Ｄｅｍｏ　")).toEqual({
      ok: true,
      value: "Demo",
    });
    expect(normalizeScrambleSeed("   ")).toMatchObject({
      ok: false,
      error: { code: "invalid-seed" },
    });
    expect(normalizeScrambleSeed("😀".repeat(65))).toMatchObject({
      ok: false,
      error: { code: "invalid-seed" },
    });
  });

  it("validates the default and 1–50 length range exactly", () => {
    expect(parseScrambleLength(undefined)).toEqual({
      ok: true,
      value: DEFAULT_SCRAMBLE_LENGTH,
    });
    expect(parseScrambleLength(" 50 ")).toEqual({ ok: true, value: 50 });
    expect(parseScrambleLength(1)).toEqual({ ok: true, value: 1 });
    expect(parseScrambleLength(0)).toMatchObject({ ok: false });
    expect(parseScrambleLength(51)).toMatchObject({ ok: false });
    expect(parseScrambleLength("1.5")).toMatchObject({ ok: false });
  });

  it("matches the version-1 golden vector", () => {
    const result = generateScramble(TOP_LAYER_EDGES, "demo");
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        seed: "demo",
        length: 14,
        moves: [
          "S'",
          "F",
          "F",
          "S",
          "F",
          "S'",
          "F",
          "S'",
          "F",
          "S'",
          "F'",
          "S",
          "S",
          "S",
        ],
        normalized: "S' F F S F S' F S' F S' F' S S S",
      },
    });
  });

  it("is reproducible, prefix-stable, and never chooses an immediate inverse", () => {
    const shortResult = generateScramble(TOP_LAYER_EDGES, " Megaminx ", 12);
    const longResult = generateScramble(TOP_LAYER_EDGES, "Megaminx", 30);
    expect(shortResult.ok).toBe(true);
    expect(longResult.ok).toBe(true);
    if (!shortResult.ok || !longResult.ok) {
      return;
    }

    expect(longResult.value.moves.slice(0, 12)).toEqual(
      shortResult.value.moves,
    );
    const inverseByMove = new Map(
      TOP_LAYER_EDGES.moves.map(({ notation, inverse }) => [notation, inverse]),
    );
    for (let index = 1; index < longResult.value.moves.length; index += 1) {
      expect(longResult.value.moves[index]).not.toBe(
        inverseByMove.get(longResult.value.moves[index - 1]),
      );
    }
  });
});
