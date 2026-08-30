import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOLVED_STATE } from "../src/core/moves";
import type { EdgeState } from "../src/core/types";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";
import type { SearchStartMessage } from "../src/worker/messages";
import { WORKER_PROTOCOL_VERSION } from "../src/worker/messages";

class FakeWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  send(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const terminalMessages = (
  scope: FakeWorkerScope,
  requestId: string,
): Record<string, unknown>[] =>
  scope.messages.filter(
    (message): message is Record<string, unknown> =>
      isRecord(message) &&
      message.requestId === requestId &&
      (message.type === "SEARCH_RESULT" || message.type === "SEARCH_FAILURE"),
  );

describe.sequential("solver worker lifecycle", () => {
  let scope: FakeWorkerScope;
  let previousSelf: PropertyDescriptor | undefined;

  beforeEach(async () => {
    vi.resetModules();
    scope = new FakeWorkerScope();
    previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    Object.defineProperty(globalThis, "self", {
      configurable: true,
      value: scope,
    });
    await import("../src/worker/solverWorker");
  });

  afterEach(() => {
    if (previousSelf) {
      Object.defineProperty(globalThis, "self", previousSelf);
    } else {
      Reflect.deleteProperty(globalThis, "self");
    }
  });

  const startMessage = (
    requestId: string,
    start: EdgeState = SOLVED_STATE,
    overrides: Partial<SearchStartMessage<EdgeState>> = {},
  ): SearchStartMessage<EdgeState> => ({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    type: "SEARCH_START",
    requestId,
    puzzleId: TOP_LAYER_EDGES.id,
    puzzleVersion: TOP_LAYER_EDGES.version,
    start,
    goal: SOLVED_STATE,
    limits: { maxNodes: 20_000, maxTimeMs: 5_000, yieldEvery: 64 },
    ...overrides,
  });

  it("emits progress and exactly one terminal result, then ignores a duplicate id", async () => {
    const request = startMessage("complete-1");
    scope.send(request);

    await vi.waitFor(() =>
      expect(terminalMessages(scope, "complete-1")).toHaveLength(1),
    );
    expect(
      scope.messages.some(
        (message) =>
          isRecord(message) &&
          message.requestId === "complete-1" &&
          message.type === "SEARCH_PROGRESS",
      ),
    ).toBe(true);
    const terminal = terminalMessages(scope, "complete-1")[0];
    expect(terminal.type).toBe("SEARCH_RESULT");
    expect(terminal.startKey).toBe("1n|2n|3n|4n|5n");

    scope.send(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminalMessages(scope, "complete-1")).toHaveLength(1);
  });

  it("acknowledges cancellation with one cancelled terminal result", async () => {
    scope.send(
      startMessage("cancel-1", SOLVED_STATE, {
        limits: { maxNodes: 20_000, maxTimeMs: 5_000, yieldEvery: 1 },
      }),
    );
    scope.send({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      type: "SEARCH_CANCEL",
      requestId: "cancel-1",
    });

    await vi.waitFor(() =>
      expect(terminalMessages(scope, "cancel-1")).toHaveLength(1),
    );
    const terminal = terminalMessages(scope, "cancel-1")[0];
    expect(terminal.type).toBe("SEARCH_RESULT");
    expect(isRecord(terminal.result) ? terminal.result.status : undefined).toBe(
      "cancelled",
    );
  });

  it("ignores a malformed duplicate while its request id is active", async () => {
    scope.send(
      startMessage("duplicate-active-1", SOLVED_STATE, {
        limits: { maxNodes: 20_000, maxTimeMs: 5_000, yieldEvery: 64 },
      }),
    );
    scope.send({
      protocolVersion: 99,
      type: "BROKEN_DUPLICATE",
      requestId: "duplicate-active-1",
      puzzleId: TOP_LAYER_EDGES.id,
      puzzleVersion: TOP_LAYER_EDGES.version,
    });

    await vi.waitFor(() =>
      expect(terminalMessages(scope, "duplicate-active-1")).toHaveLength(1),
    );
    expect(terminalMessages(scope, "duplicate-active-1")[0].type).toBe(
      "SEARCH_RESULT",
    );
  });

  it("fails unknown definitions and definition-invalid state payloads once", async () => {
    scope.send(
      startMessage("unknown-1", SOLVED_STATE, { puzzleId: "missing" }),
    );
    scope.send(
      startMessage("invalid-state-1", SOLVED_STATE, {
        start: [] as unknown as EdgeState,
      }),
    );

    await vi.waitFor(() => {
      expect(terminalMessages(scope, "unknown-1")).toHaveLength(1);
      expect(terminalMessages(scope, "invalid-state-1")).toHaveLength(1);
    });
    const unknownError = terminalMessages(scope, "unknown-1")[0].error;
    const invalidError = terminalMessages(scope, "invalid-state-1")[0].error;
    expect(isRecord(unknownError) ? unknownError.code : undefined).toBe(
      "UNKNOWN_PUZZLE",
    );
    expect(isRecord(invalidError) ? invalidError.code : undefined).toBe(
      "INVALID_PUZZLE_STATE",
    );
  });
});
