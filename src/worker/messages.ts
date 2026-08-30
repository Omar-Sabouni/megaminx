import type { SearchOutcome, SearchProgress } from "../core/search";
import type { BfsTreeResult, EdgeState, Move } from "../core/types";
import type { ParseResult, PuzzleDefinition } from "../puzzles/types";

export const WORKER_PROTOCOL_VERSION = 1 as const;
export type WorkerRequestId = number | string;

export interface WorkerSearchLimits {
  readonly maxNodes?: number;
  readonly maxTimeMs?: number;
  readonly yieldEvery?: number;
}

export interface SearchStartMessage<State = unknown> {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly type: "SEARCH_START";
  readonly requestId: WorkerRequestId;
  readonly puzzleId: string;
  readonly puzzleVersion: number;
  readonly start: State;
  readonly goal: State;
  readonly limits?: WorkerSearchLimits;
}

export interface SearchCancelMessage {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly type: "SEARCH_CANCEL";
  readonly requestId: WorkerRequestId;
}

export type ModernSolverWorkerInbound<State = unknown> =
  SearchStartMessage<State> | SearchCancelMessage;

interface SearchResponseBase {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly requestId: WorkerRequestId;
  readonly puzzleId: string;
  readonly puzzleVersion: number;
  readonly startKey: string;
  readonly goalKey: string;
}

export interface SearchProgressMessage extends SearchResponseBase {
  readonly type: "SEARCH_PROGRESS";
  readonly progress: SearchProgress;
}

export interface SearchResultMessage<
  State = EdgeState,
  MoveType extends string = Move,
> extends SearchResponseBase {
  readonly type: "SEARCH_RESULT";
  readonly result: SearchOutcome<State, MoveType>;
}

export interface SearchFailureMessage {
  readonly protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  readonly type: "SEARCH_FAILURE";
  readonly requestId: WorkerRequestId;
  readonly puzzleId: string;
  /** Missing only when the inbound message could not identify a definition version. */
  readonly puzzleVersion?: number;
  readonly startKey?: string;
  readonly goalKey?: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type ModernSolverWorkerOutbound<
  State = EdgeState,
  MoveType extends string = Move,
> =
  | SearchProgressMessage
  | SearchResultMessage<State, MoveType>
  | SearchFailureMessage;

/* Legacy request/response contracts retained while older embeds migrate. */
export interface SolveRequestMessage {
  readonly type: "SOLVE";
  readonly requestId: number;
  readonly start: EdgeState;
  readonly goal: EdgeState;
}

export interface SolveResultMessage {
  readonly type: "SOLVE_RESULT";
  readonly requestId: number;
  readonly reachable: boolean;
  readonly word?: readonly Move[];
  readonly depth?: number;
  readonly reason?: string;
}

export interface BfsTreeRequestMessage {
  readonly type: "BFS_TREE";
  readonly requestId: number;
  readonly root: EdgeState;
  readonly current: EdgeState;
  readonly maxDepth: number;
}

export interface BfsTreeResultMessage {
  readonly type: "BFS_TREE_RESULT";
  readonly requestId: number;
  readonly tree: BfsTreeResult;
}

export type LegacySolverWorkerInbound =
  SolveRequestMessage | BfsTreeRequestMessage;
export type LegacySolverWorkerOutbound =
  SolveResultMessage | BfsTreeResultMessage;
export type SolverWorkerInbound =
  ModernSolverWorkerInbound<EdgeState> | LegacySolverWorkerInbound;
export type SolverWorkerOutbound =
  ModernSolverWorkerOutbound<EdgeState, Move> | LegacySolverWorkerOutbound;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isWorkerRequestId = (value: unknown): value is WorkerRequestId =>
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
  (typeof value === "string" && value.length > 0 && value.length <= 128);

const isOptionalPositiveNumber = (value: unknown, integer: boolean): boolean =>
  value === undefined ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    (!integer || Number.isInteger(value)));

const isWorkerSearchLimits = (value: unknown): value is WorkerSearchLimits => {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalPositiveNumber(value.maxNodes, true) &&
    isOptionalPositiveNumber(value.maxTimeMs, false) &&
    isOptionalPositiveNumber(value.yieldEvery, true)
  );
};

export const isModernSolverWorkerInbound = (
  value: unknown,
): value is ModernSolverWorkerInbound<unknown> => {
  if (
    !isRecord(value) ||
    value.protocolVersion !== WORKER_PROTOCOL_VERSION ||
    !isWorkerRequestId(value.requestId)
  ) {
    return false;
  }
  if (value.type === "SEARCH_CANCEL") {
    return true;
  }
  return (
    value.type === "SEARCH_START" &&
    typeof value.puzzleId === "string" &&
    value.puzzleId.length > 0 &&
    typeof value.puzzleVersion === "number" &&
    Number.isSafeInteger(value.puzzleVersion) &&
    value.puzzleVersion > 0 &&
    Object.hasOwn(value, "start") &&
    Object.hasOwn(value, "goal") &&
    isWorkerSearchLimits(value.limits)
  );
};

export const parseSolverWorkerInbound = (
  value: unknown,
): ParseResult<ModernSolverWorkerInbound<unknown>> =>
  isModernSolverWorkerInbound(value)
    ? { ok: true, value }
    : {
        ok: false,
        error: {
          code: "INVALID_WORKER_MESSAGE",
          message: "Worker message does not match protocol version 1.",
        },
      };

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isSearchMetrics = (value: unknown): boolean =>
  isRecord(value) &&
  isNonNegativeInteger(value.visited) &&
  isNonNegativeInteger(value.expanded) &&
  isNonNegativeInteger(value.frontier) &&
  typeof value.elapsedMs === "number" &&
  Number.isFinite(value.elapsedMs) &&
  value.elapsedMs >= 0 &&
  isNonNegativeInteger(value.maxDepth);

const isSearchLayers = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (layer, index) =>
      isRecord(layer) &&
      isNonNegativeInteger(layer.depth) &&
      layer.depth === index &&
      isNonNegativeInteger(layer.count) &&
      typeof layer.complete === "boolean",
  );

const hasConsistentSearchSummary = (
  value: Record<string, unknown>,
): boolean => {
  if (
    !isSearchLayers(value.layers) ||
    !isSearchMetrics(value.metrics) ||
    typeof value.componentComplete !== "boolean"
  ) {
    return false;
  }
  const layers = value.layers as SearchProgress["layers"];
  const metrics = value.metrics as SearchProgress["metrics"];
  const total = layers.reduce((sum, layer) => sum + layer.count, 0);
  const firstIncomplete = layers.findIndex((layer) => !layer.complete);
  const completenessIsPrefix =
    firstIncomplete < 0 ||
    layers.slice(firstIncomplete).every((layer) => !layer.complete);
  return (
    layers[0]?.count === 1 &&
    total === metrics.visited &&
    metrics.expanded + metrics.frontier === metrics.visited &&
    metrics.maxDepth === layers.length - 1 &&
    completenessIsPrefix &&
    (!value.componentComplete ||
      (metrics.frontier === 0 &&
        metrics.expanded === metrics.visited &&
        layers.every((layer) => layer.complete)))
  );
};

const isSearchProgress = (value: unknown): value is SearchProgress =>
  isRecord(value) &&
  typeof value.startKey === "string" &&
  typeof value.goalKey === "string" &&
  hasConsistentSearchSummary(value);

const isSearchOutcomeShape = (
  value: unknown,
): value is SearchOutcome<unknown, string> => {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    typeof value.startKey !== "string" ||
    typeof value.goalKey !== "string" ||
    typeof value.startComponentKey !== "string" ||
    typeof value.goalComponentKey !== "string" ||
    !hasConsistentSearchSummary(value)
  ) {
    return false;
  }
  switch (value.status) {
    case "found":
      return (
        value.componentComplete === true &&
        isNonNegativeInteger(value.depth) &&
        Array.isArray(value.word) &&
        value.word.every((move) => typeof move === "string") &&
        Array.isArray(value.path) &&
        Array.isArray(value.pathKeys) &&
        value.pathKeys.every((key) => typeof key === "string") &&
        value.word.length === value.depth &&
        value.path.length === value.depth + 1 &&
        value.pathKeys.length === value.path.length
      );
    case "unreachable":
      return (
        value.componentComplete === true && typeof value.reason === "string"
      );
    case "node-limit":
      return (
        value.componentComplete === false &&
        typeof value.reason === "string" &&
        isNonNegativeInteger(value.limit) &&
        value.limit > 0
      );
    case "time-limit":
      return (
        value.componentComplete === false &&
        typeof value.reason === "string" &&
        typeof value.limitMs === "number" &&
        Number.isFinite(value.limitMs) &&
        value.limitMs > 0
      );
    case "cancelled":
      return (
        value.componentComplete === false && typeof value.reason === "string"
      );
    default:
      return false;
  }
};

const isSearchOutcomeForPuzzle = <State, MoveType extends string>(
  value: unknown,
  puzzle: PuzzleDefinition<State, MoveType>,
): value is SearchOutcome<State, MoveType> => {
  if (!isSearchOutcomeShape(value)) {
    return false;
  }
  if (value.status !== "found") {
    return true;
  }

  const registeredMoves = new Set<string>(
    puzzle.moves.map((move) => move.notation),
  );
  if (
    !value.word.every((move): move is MoveType => registeredMoves.has(move)) ||
    !value.path.every(puzzle.isState)
  ) {
    return false;
  }

  try {
    const serializedPath = value.path.map((state) => puzzle.serialize(state));
    if (
      serializedPath.some((key, index) => key !== value.pathKeys[index]) ||
      serializedPath[0] !== value.startKey ||
      serializedPath.at(-1) !== value.goalKey ||
      puzzle.componentKey(value.path[0]) !== value.startComponentKey ||
      puzzle.componentKey(value.path.at(-1) as State) !== value.goalComponentKey
    ) {
      return false;
    }
    for (let index = 0; index < value.word.length; index += 1) {
      const next = puzzle.applyMove(value.path[index], value.word[index]);
      if (puzzle.serialize(next) !== value.pathKeys[index + 1]) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
};

export const isSearchStartForPuzzle = <State, MoveType extends string>(
  message: SearchStartMessage<unknown>,
  puzzle: PuzzleDefinition<State, MoveType>,
): message is SearchStartMessage<State> =>
  message.puzzleId === puzzle.id &&
  message.puzzleVersion === puzzle.version &&
  puzzle.isState(message.start) &&
  puzzle.isState(message.goal);

export function isModernSolverWorkerOutbound<State, MoveType extends string>(
  value: unknown,
  puzzle: PuzzleDefinition<State, MoveType>,
): value is ModernSolverWorkerOutbound<State, MoveType>;
export function isModernSolverWorkerOutbound(
  value: unknown,
): value is ModernSolverWorkerOutbound;
export function isModernSolverWorkerOutbound<State, MoveType extends string>(
  value: unknown,
  puzzle?: PuzzleDefinition<State, MoveType>,
): value is ModernSolverWorkerOutbound<State, MoveType> {
  if (
    !isRecord(value) ||
    value.protocolVersion !== WORKER_PROTOCOL_VERSION ||
    !isWorkerRequestId(value.requestId) ||
    typeof value.puzzleId !== "string" ||
    value.puzzleId.length === 0
  ) {
    return false;
  }
  if (value.type === "SEARCH_FAILURE") {
    const versionIsValid =
      value.puzzleVersion === undefined ||
      (isNonNegativeInteger(value.puzzleVersion) && value.puzzleVersion > 0);
    return (
      versionIsValid &&
      (puzzle === undefined ||
        (value.puzzleId === puzzle.id &&
          value.puzzleVersion === puzzle.version)) &&
      (value.startKey === undefined || typeof value.startKey === "string") &&
      (value.goalKey === undefined || typeof value.goalKey === "string") &&
      isRecord(value.error) &&
      typeof value.error.code === "string" &&
      typeof value.error.message === "string" &&
      typeof value.error.retryable === "boolean"
    );
  }
  if (
    !isNonNegativeInteger(value.puzzleVersion) ||
    value.puzzleVersion <= 0 ||
    typeof value.startKey !== "string" ||
    typeof value.goalKey !== "string" ||
    (puzzle !== undefined &&
      (value.puzzleId !== puzzle.id || value.puzzleVersion !== puzzle.version))
  ) {
    return false;
  }
  if (value.type === "SEARCH_PROGRESS") {
    return (
      isSearchProgress(value.progress) &&
      value.progress.startKey === value.startKey &&
      value.progress.goalKey === value.goalKey
    );
  }
  if (value.type !== "SEARCH_RESULT") {
    return false;
  }
  const result = value.result;
  if (puzzle === undefined) {
    if (!isSearchOutcomeShape(result)) {
      return false;
    }
    return (
      result.startKey === value.startKey && result.goalKey === value.goalKey
    );
  }
  if (!isSearchOutcomeForPuzzle(result, puzzle)) {
    return false;
  }
  return result.startKey === value.startKey && result.goalKey === value.goalKey;
}
