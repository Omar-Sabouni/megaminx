/// <reference lib="webworker" />

import { buildBfsTree } from "../core/bfs-tree";
import { isEdgeState } from "../core/moves";
import { searchPuzzle } from "../core/search";
import { findShortestWord } from "../core/solver-bfs";
import { getPuzzleDefinition } from "../puzzles/registry";
import {
  isModernSolverWorkerInbound,
  isWorkerRequestId,
  WORKER_PROTOCOL_VERSION,
} from "./messages";
import type {
  BfsTreeRequestMessage,
  LegacySolverWorkerOutbound,
  ModernSolverWorkerOutbound,
  SearchFailureMessage,
  SearchStartMessage,
  SolveRequestMessage,
  WorkerRequestId,
} from "./messages";

const workerContext: DedicatedWorkerGlobalScope =
  self as DedicatedWorkerGlobalScope;

interface ActiveSearch {
  readonly controller: AbortController;
}

const activeSearches = new Map<string, ActiveSearch>();
const completedRequestKeys = new Set<string>();
const completedRequestOrder: string[] = [];
const COMPLETED_REQUEST_WINDOW = 1_024;
const requestKey = (requestId: WorkerRequestId): string =>
  `${typeof requestId}:${String(requestId)}`;

const markRequestCompleted = (requestId: WorkerRequestId): void => {
  const key = requestKey(requestId);
  if (completedRequestKeys.has(key)) {
    return;
  }
  completedRequestKeys.add(key);
  completedRequestOrder.push(key);
  if (completedRequestOrder.length > COMPLETED_REQUEST_WINDOW) {
    const expired = completedRequestOrder.shift();
    if (expired !== undefined) {
      completedRequestKeys.delete(expired);
    }
  }
};

const postModern = <State, MoveType extends string>(
  message: ModernSolverWorkerOutbound<State, MoveType>,
): void => {
  workerContext.postMessage(message);
};

const postFailure = (
  requestId: WorkerRequestId,
  puzzleId: string,
  puzzleVersion: number | undefined,
  code: string,
  message: string,
  retryable: boolean,
  anchors: { readonly startKey?: string; readonly goalKey?: string } = {},
): void => {
  if (completedRequestKeys.has(requestKey(requestId))) {
    return;
  }
  const payload: SearchFailureMessage = {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    type: "SEARCH_FAILURE",
    requestId,
    puzzleId,
    ...(puzzleVersion === undefined ? {} : { puzzleVersion }),
    ...anchors,
    error: { code, message, retryable },
  };
  postModern(payload);
  markRequestCompleted(requestId);
};

const handleSearchStart = async (
  message: SearchStartMessage<unknown>,
): Promise<void> => {
  const key = requestKey(message.requestId);
  // Request ids are idempotency keys. In-flight and recent completed starts are
  // ignored rather than creating a second terminal response for the same id.
  if (activeSearches.has(key) || completedRequestKeys.has(key)) {
    return;
  }

  const puzzle = getPuzzleDefinition(message.puzzleId);
  if (!puzzle) {
    postFailure(
      message.requestId,
      message.puzzleId,
      message.puzzleVersion,
      "UNKNOWN_PUZZLE",
      `Unknown puzzle definition "${message.puzzleId}".`,
      false,
    );
    return;
  }

  if (message.puzzleVersion !== puzzle.version) {
    postFailure(
      message.requestId,
      message.puzzleId,
      message.puzzleVersion,
      "PUZZLE_VERSION_MISMATCH",
      `Puzzle definition version ${message.puzzleVersion} is unavailable; expected version ${puzzle.version}.`,
      false,
    );
    return;
  }
  const { requestId, puzzleId, puzzleVersion, start, goal, limits } = message;
  if (!puzzle.isState(start) || !puzzle.isState(goal)) {
    postFailure(
      requestId,
      puzzleId,
      puzzleVersion,
      "INVALID_PUZZLE_STATE",
      `Start or goal is invalid for puzzle "${puzzleId}".`,
      false,
    );
    return;
  }

  const startKey = puzzle.serialize(start);
  const goalKey = puzzle.serialize(goal);
  const controller = new AbortController();
  const active: ActiveSearch = { controller };
  activeSearches.set(key, active);
  let terminalSent = false;

  try {
    const result = await searchPuzzle(puzzle, start, goal, {
      ...limits,
      signal: controller.signal,
      onProgress: (progress) => {
        if (terminalSent) {
          return;
        }
        postModern({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: "SEARCH_PROGRESS",
          requestId,
          puzzleId,
          puzzleVersion,
          startKey,
          goalKey,
          progress,
        });
      },
    });

    if (!terminalSent) {
      terminalSent = true;
      postModern({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        type: "SEARCH_RESULT",
        requestId,
        puzzleId,
        puzzleVersion,
        startKey,
        goalKey,
        result,
      });
      markRequestCompleted(requestId);
    }
  } catch (error) {
    if (!terminalSent) {
      terminalSent = true;
      postFailure(
        requestId,
        puzzleId,
        puzzleVersion,
        "SEARCH_ERROR",
        error instanceof Error ? error.message : "Unknown search failure.",
        true,
        { startKey, goalKey },
      );
    }
  } finally {
    if (activeSearches.get(key) === active) {
      activeSearches.delete(key);
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSolveRequest = (value: unknown): value is SolveRequestMessage =>
  isRecord(value) &&
  value.type === "SOLVE" &&
  typeof value.requestId === "number" &&
  Number.isSafeInteger(value.requestId) &&
  value.requestId >= 0 &&
  isEdgeState(value.start) &&
  isEdgeState(value.goal);

const isBfsTreeRequest = (value: unknown): value is BfsTreeRequestMessage =>
  isRecord(value) &&
  value.type === "BFS_TREE" &&
  typeof value.requestId === "number" &&
  Number.isSafeInteger(value.requestId) &&
  value.requestId >= 0 &&
  isEdgeState(value.root) &&
  isEdgeState(value.current) &&
  typeof value.maxDepth === "number" &&
  Number.isSafeInteger(value.maxDepth) &&
  value.maxDepth >= 0 &&
  value.maxDepth <= 100;

const handleLegacy = (message: unknown): boolean => {
  if (isSolveRequest(message)) {
    const result = findShortestWord(message.start, message.goal);
    const payload: LegacySolverWorkerOutbound = {
      type: "SOLVE_RESULT",
      requestId: message.requestId,
      reachable: result.reachable,
      ...(result.reachable
        ? { word: result.word, depth: result.depth }
        : { reason: result.reason }),
    };
    workerContext.postMessage(payload);
    return true;
  }

  if (isBfsTreeRequest(message)) {
    const tree = buildBfsTree(message.root, message.current, {
      maxDepth: message.maxDepth,
    });
    const payload: LegacySolverWorkerOutbound = {
      type: "BFS_TREE_RESULT",
      requestId: message.requestId,
      tree,
    };
    workerContext.postMessage(payload);
    return true;
  }
  return false;
};

workerContext.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (isModernSolverWorkerInbound(message)) {
    if (message.type === "SEARCH_CANCEL") {
      activeSearches.get(requestKey(message.requestId))?.controller.abort();
      return;
    }
    void handleSearchStart(message);
    return;
  }

  if (handleLegacy(message)) {
    return;
  }

  const record = isRecord(message) ? message : {};
  const requestId = isWorkerRequestId(record.requestId)
    ? record.requestId
    : "invalid-message";
  // Request ids are idempotency keys across every inbound shape. A malformed
  // duplicate must not race an already-running request and create two terminal
  // messages for the same id.
  if (activeSearches.has(requestKey(requestId))) {
    return;
  }
  const puzzleId = typeof record.puzzleId === "string" ? record.puzzleId : "";
  const puzzleVersion =
    typeof record.puzzleVersion === "number" &&
    Number.isSafeInteger(record.puzzleVersion)
      ? record.puzzleVersion
      : undefined;
  postFailure(
    requestId,
    puzzleId,
    puzzleVersion,
    "INVALID_WORKER_MESSAGE",
    "Worker message does not match protocol version 1.",
    false,
  );
};
