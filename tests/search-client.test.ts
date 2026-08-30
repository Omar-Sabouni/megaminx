// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { searchPuzzle } from "../src/core/search";
import { applyWord, serialize, SOLVED_STATE } from "../src/core/moves";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";
import {
  SearchCancelledError,
  SearchClient,
  SearchClientError,
} from "../src/services/search-client";
import { WORKER_PROTOCOL_VERSION } from "../src/worker/messages";
import type { ModernSolverWorkerOutbound } from "../src/worker/messages";

class FakeWorker extends EventTarget {
  readonly posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(message: ModernSolverWorkerOutbound): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  emitError(message: string): void {
    this.dispatchEvent(new ErrorEvent("error", { message }));
  }
}

const resultMessage = async (
  requestId: string,
  start = SOLVED_STATE,
): Promise<ModernSolverWorkerOutbound> => {
  const result = await searchPuzzle(TOP_LAYER_EDGES, start, SOLVED_STATE);
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    type: "SEARCH_RESULT",
    requestId,
    puzzleId: TOP_LAYER_EDGES.id,
    puzzleVersion: TOP_LAYER_EDGES.version,
    startKey: serialize(start),
    goalKey: serialize(SOLVED_STATE),
    result,
  };
};

describe("search client", () => {
  it("settles a superseded request and ignores its late result", async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker as unknown as Worker);
    const first = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    const secondStart = applyWord(SOLVED_STATE, ["S", "F"]);
    const second = client.search(TOP_LAYER_EDGES, secondStart, SOLVED_STATE);

    await expect(first).rejects.toBeInstanceOf(SearchCancelledError);
    const starts = worker.posted.filter(
      (message): message is { type: string; requestId: string } =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as { type: string }).type === "SEARCH_START",
    );
    expect(starts).toHaveLength(2);

    worker.emitMessage(await resultMessage(starts[0].requestId));
    worker.emitMessage(await resultMessage(starts[1].requestId, secondStart));
    await expect(second).resolves.toMatchObject({
      status: "found",
      startKey: serialize(secondStart),
    });
    client.dispose();
  });

  it("settles an explicit cancellation before a raced result can arrive", async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker as unknown as Worker);
    const pending = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    const start = worker.posted.find(
      (message): message is { type: "SEARCH_START"; requestId: string } =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "SEARCH_START",
    );

    expect(start).toBeDefined();
    const cancellation =
      expect(pending).rejects.toBeInstanceOf(SearchCancelledError);
    client.cancel();
    worker.emitMessage(await resultMessage(start!.requestId));

    await cancellation;
    expect(client.active).toBe(false);
    client.dispose();
  });

  it("rejects a malformed response for the active request", async () => {
    const workers: FakeWorker[] = [];
    const client = new SearchClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const pending = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    const start = workers[0].posted[0] as { requestId: string };

    workers[0].dispatchEvent(
      new MessageEvent("message", {
        data: {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: "SEARCH_RESULT",
          requestId: start.requestId,
          puzzleId: TOP_LAYER_EDGES.id,
        },
      }),
    );

    await expect(pending).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("rejects pending work and recreates once after worker failure", async () => {
    const workers: FakeWorker[] = [];
    const client = new SearchClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const pending = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    workers[0].emitError("boom");
    await expect(pending).rejects.toBeInstanceOf(SearchClientError);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    client.dispose();
  });

  it("recovers on the next explicit search when automatic recreation failed", async () => {
    const firstWorker = new FakeWorker();
    const retryWorker = new FakeWorker();
    let attempts = 0;
    const client = new SearchClient(() => {
      attempts += 1;
      if (attempts === 1) return firstWorker as unknown as Worker;
      if (attempts === 2) throw new Error("worker construction failed");
      return retryWorker as unknown as Worker;
    });

    const failed = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    firstWorker.emitError("boom");
    await expect(failed).rejects.toBeInstanceOf(SearchClientError);

    const retry = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    const start = retryWorker.posted[0] as { requestId: string };
    retryWorker.emitMessage(await resultMessage(start.requestId));
    await expect(retry).resolves.toMatchObject({ status: "found" });
    expect(attempts).toBe(3);
    client.dispose();
  });

  it("retires a worker that misses its terminal-response watchdog", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const client = new SearchClient(() => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      });
      const pending = client.search(
        TOP_LAYER_EDGES,
        SOLVED_STATE,
        SOLVED_STATE,
        {
          limits: { maxTimeMs: 1 },
        },
      );
      const rejection = expect(pending).rejects.toMatchObject({
        code: "WORKER_TIMEOUT",
      });

      await vi.advanceTimersByTimeAsync(1_001);

      await rejection;
      expect(workers).toHaveLength(2);
      expect(workers[0].terminated).toBe(true);
      client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-found results with mismatched component anchors", async () => {
    const worker = new FakeWorker();
    const client = new SearchClient(() => worker as unknown as Worker);
    const pending = client.search(TOP_LAYER_EDGES, SOLVED_STATE, SOLVED_STATE);
    const start = worker.posted[0] as { requestId: string };
    const parsed = TOP_LAYER_EDGES.parseState("[1', 2, 3, 4, 5]");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const unreachable = await searchPuzzle(
      TOP_LAYER_EDGES,
      parsed.value,
      SOLVED_STATE,
    );
    expect(unreachable.status).toBe("unreachable");
    if (unreachable.status !== "unreachable") return;

    worker.emitMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      type: "SEARCH_RESULT",
      requestId: start.requestId,
      puzzleId: TOP_LAYER_EDGES.id,
      puzzleVersion: TOP_LAYER_EDGES.version,
      startKey: serialize(SOLVED_STATE),
      goalKey: serialize(SOLVED_STATE),
      result: {
        ...unreachable,
        startKey: serialize(SOLVED_STATE),
        goalKey: serialize(SOLVED_STATE),
      },
    });

    await expect(pending).rejects.toMatchObject({ code: "ANCHOR_MISMATCH" });
    client.dispose();
  });
});
