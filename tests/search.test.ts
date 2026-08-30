import { describe, expect, it } from "vitest";
import { applyWord, SOLVED_STATE } from "../src/core/moves";
import { searchPuzzle } from "../src/core/search";
import type { EdgeState } from "../src/core/types";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

const EXPECTED_LAYERS = [1, 4, 10, 24, 56, 129, 247, 320, 150, 19];

describe("searchPuzzle", () => {
  it("returns an exact shortest path and the complete 960-state histogram", async () => {
    const start = applyWord(SOLVED_STATE, ["F", "S", "F"]);
    const result = await searchPuzzle(TOP_LAYER_EDGES, start, SOLVED_STATE);

    expect(result.status).toBe("found");
    expect(result.componentComplete).toBe(true);
    expect(result.layers.map((layer) => layer.count)).toEqual(EXPECTED_LAYERS);
    expect(result.layers.every((layer) => layer.complete)).toBe(true);
    expect(result.metrics).toMatchObject({
      visited: 960,
      expanded: 960,
      frontier: 0,
    });
    if (result.status === "found") {
      expect(result.depth).toBe(3);
      expect(result.path).toHaveLength(result.word.length + 1);
      expect(TOP_LAYER_EDGES.serialize(result.path[0])).toBe(result.startKey);
      expect(TOP_LAYER_EDGES.serialize(result.path.at(-1) as EdgeState)).toBe(
        result.goalKey,
      );
      expect(TOP_LAYER_EDGES.serialize(applyWord(start, result.word))).toBe(
        TOP_LAYER_EDGES.serialize(SOLVED_STATE),
      );
    }
  });

  it("traverses a complete component before reporting parity-unreachable", async () => {
    const unreachable: EdgeState = [
      { id: 1, flipped: true },
      { id: 2, flipped: false },
      { id: 3, flipped: false },
      { id: 4, flipped: false },
      { id: 5, flipped: false },
    ];
    const result = await searchPuzzle(
      TOP_LAYER_EDGES,
      unreachable,
      SOLVED_STATE,
    );

    expect(result.status).toBe("unreachable");
    expect(result.componentComplete).toBe(true);
    expect(result.metrics.visited).toBe(960);
    expect(result.layers.reduce((sum, layer) => sum + layer.count, 0)).toBe(
      960,
    );
  });

  it("reports a partial, honest histogram at the node limit", async () => {
    const result = await searchPuzzle(
      TOP_LAYER_EDGES,
      SOLVED_STATE,
      SOLVED_STATE,
      {
        maxNodes: 20,
      },
    );

    expect(result.status).toBe("node-limit");
    expect(result.componentComplete).toBe(false);
    expect(result.metrics.visited).toBe(20);
    expect(result.layers.some((layer) => !layer.complete)).toBe(true);
  });

  it("can be cancelled at a chunk boundary", async () => {
    const controller = new AbortController();
    const result = await searchPuzzle(
      TOP_LAYER_EDGES,
      SOLVED_STATE,
      SOLVED_STATE,
      {
        signal: controller.signal,
        yieldEvery: 1,
        yieldControl: async () => {
          controller.abort();
        },
      },
    );

    expect(result.status).toBe("cancelled");
    expect(result.componentComplete).toBe(false);
    expect(result.metrics.visited).toBeGreaterThan(1);
  });

  it("validates finite positive search limits", async () => {
    await expect(
      searchPuzzle(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE, {
        maxNodes: Infinity,
      }),
    ).rejects.toThrow(/maxNodes/);
    await expect(
      searchPuzzle(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE, {
        maxTimeMs: 0,
      }),
    ).rejects.toThrow(/maxTimeMs/);
  });
});
