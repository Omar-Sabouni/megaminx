import { describe, expect, it } from "vitest";
import { SOLVED_STATE } from "../src/core/moves";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";
import {
  isModernSolverWorkerInbound,
  isModernSolverWorkerOutbound,
  isSearchStartForPuzzle,
  parseSolverWorkerInbound,
  WORKER_PROTOCOL_VERSION,
} from "../src/worker/messages";

describe("worker protocol validation", () => {
  const validStart = {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    type: "SEARCH_START",
    requestId: "analysis-1",
    puzzleId: "top-layer-edges",
    puzzleVersion: 1,
    start: SOLVED_STATE,
    goal: SOLVED_STATE,
    limits: { maxNodes: 20_000, maxTimeMs: 5_000, yieldEvery: 64 },
  } as const;

  it("accepts versioned start and cancel messages", () => {
    expect(isModernSolverWorkerInbound(validStart)).toBe(true);
    expect(
      isModernSolverWorkerInbound({
        protocolVersion: 1,
        type: "SEARCH_CANCEL",
        requestId: "analysis-1",
      }),
    ).toBe(true);
  });

  it("rejects unknown protocol versions and invalid limits before puzzle dispatch", () => {
    expect(
      isModernSolverWorkerInbound({ ...validStart, protocolVersion: 2 }),
    ).toBe(false);
    expect(
      isModernSolverWorkerInbound({ ...validStart, limits: { maxNodes: 0 } }),
    ).toBe(false);
    const parsed = parseSolverWorkerInbound({ ...validStart, requestId: "" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("INVALID_WORKER_MESSAGE");
    }
  });

  it("delegates generic state/version checks to the registered definition", () => {
    const malformed = { ...validStart, start: [] };
    expect(isModernSolverWorkerInbound(malformed)).toBe(true);
    expect(isSearchStartForPuzzle(malformed, TOP_LAYER_EDGES)).toBe(false);
    expect(isSearchStartForPuzzle(validStart, TOP_LAYER_EDGES)).toBe(true);
    expect(
      isSearchStartForPuzzle(
        { ...validStart, puzzleVersion: 2 },
        TOP_LAYER_EDGES,
      ),
    ).toBe(false);
  });

  it("validates result anchors, paths, transitions, and puzzle version", () => {
    const result = {
      status: "found",
      startKey: "1n|2n|3n|4n|5n",
      goalKey: "1n|2n|3n|4n|5n",
      startComponentKey: "0:0",
      goalComponentKey: "0:0",
      layers: [{ depth: 0, count: 1, complete: true }],
      metrics: {
        visited: 1,
        expanded: 1,
        frontier: 0,
        elapsedMs: 0,
        maxDepth: 0,
      },
      componentComplete: true,
      depth: 0,
      word: [],
      path: [SOLVED_STATE],
      pathKeys: ["1n|2n|3n|4n|5n"],
    } as const;
    const message = {
      protocolVersion: 1,
      type: "SEARCH_RESULT",
      requestId: "analysis-1",
      puzzleId: TOP_LAYER_EDGES.id,
      puzzleVersion: TOP_LAYER_EDGES.version,
      startKey: result.startKey,
      goalKey: result.goalKey,
      result,
    } as const;

    expect(isModernSolverWorkerOutbound(message, TOP_LAYER_EDGES)).toBe(true);
    expect(
      isModernSolverWorkerOutbound(
        { ...message, result: { ...result, pathKeys: ["corrupt"] } },
        TOP_LAYER_EDGES,
      ),
    ).toBe(false);
    expect(
      isModernSolverWorkerOutbound(
        { ...message, puzzleVersion: 2 },
        TOP_LAYER_EDGES,
      ),
    ).toBe(false);
  });
});
