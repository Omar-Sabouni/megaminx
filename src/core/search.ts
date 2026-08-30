import type { MoveSpec, PuzzleDefinition } from "../puzzles/types";

export const DEFAULT_SEARCH_MAX_NODES = 20_000;
export const DEFAULT_SEARCH_MAX_TIME_MS = 5_000;
export const DEFAULT_SEARCH_YIELD_EVERY = 64;

export interface SearchLayer {
  readonly depth: number;
  readonly count: number;
  /** False only when an interrupted search may not have discovered the full layer. */
  readonly complete: boolean;
}

export interface SearchMetrics {
  readonly visited: number;
  readonly expanded: number;
  readonly frontier: number;
  readonly elapsedMs: number;
  readonly maxDepth: number;
}

export interface SearchProgress {
  readonly startKey: string;
  readonly goalKey: string;
  readonly layers: readonly SearchLayer[];
  readonly metrics: SearchMetrics;
  readonly componentComplete: boolean;
}

interface SearchOutcomeBase {
  readonly startKey: string;
  readonly goalKey: string;
  readonly startComponentKey: string;
  readonly goalComponentKey: string;
  readonly layers: readonly SearchLayer[];
  readonly metrics: SearchMetrics;
  readonly componentComplete: boolean;
}

export interface SearchFound<
  State,
  Move extends string,
> extends SearchOutcomeBase {
  readonly status: "found";
  readonly componentComplete: true;
  readonly depth: number;
  readonly word: readonly Move[];
  readonly path: readonly State[];
  readonly pathKeys: readonly string[];
}

export interface SearchUnreachable extends SearchOutcomeBase {
  readonly status: "unreachable";
  readonly componentComplete: true;
  readonly reason: string;
}

export interface SearchNodeLimit extends SearchOutcomeBase {
  readonly status: "node-limit";
  readonly componentComplete: false;
  readonly reason: string;
  readonly limit: number;
}

export interface SearchTimeLimit extends SearchOutcomeBase {
  readonly status: "time-limit";
  readonly componentComplete: false;
  readonly reason: string;
  readonly limitMs: number;
}

export interface SearchCancelled extends SearchOutcomeBase {
  readonly status: "cancelled";
  readonly componentComplete: false;
  readonly reason: string;
}

export type SearchOutcome<State, Move extends string> =
  | SearchFound<State, Move>
  | SearchUnreachable
  | SearchNodeLimit
  | SearchTimeLimit
  | SearchCancelled;

export interface SearchOptions {
  readonly maxNodes?: number;
  readonly maxTimeMs?: number;
  readonly yieldEvery?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SearchProgress) => void;
  /** Test/host hook; normal callers should use the default event-loop yield. */
  readonly yieldControl?: () => Promise<void>;
  /** Test/host hook for a monotonic clock. */
  readonly now?: () => number;
}

interface QueueEntry<State> {
  readonly key: string;
  readonly state: State;
  readonly depth: number;
}

interface ParentLink<Move extends string> {
  readonly prev: string;
  readonly move: Move;
}

const defaultNow = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive integer.`);
  }
  return value;
};

const positiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
  return value;
};

const moveNotations = <Move extends string>(
  specs: readonly MoveSpec<Move>[],
): readonly Move[] => specs.map((spec) => spec.notation);

/**
 * Breadth-first analysis that deliberately finishes the start component after
 * finding the goal. That makes both the shortest path and distance histogram
 * exact. It yields in chunks so a Worker can process cancellation messages.
 */
export const searchPuzzle = async <State, Move extends string>(
  puzzle: PuzzleDefinition<State, Move>,
  start: State,
  goal: State,
  options: SearchOptions = {},
): Promise<SearchOutcome<State, Move>> => {
  if (!puzzle.isState(start) || !puzzle.isState(goal)) {
    throw new TypeError(`Invalid state supplied for puzzle "${puzzle.id}".`);
  }

  const maxNodes = positiveInteger(
    options.maxNodes ?? DEFAULT_SEARCH_MAX_NODES,
    "maxNodes",
  );
  const maxTimeMs = positiveFinite(
    options.maxTimeMs ?? DEFAULT_SEARCH_MAX_TIME_MS,
    "maxTimeMs",
  );
  const yieldEvery = positiveInteger(
    options.yieldEvery ?? DEFAULT_SEARCH_YIELD_EVERY,
    "yieldEvery",
  );
  const now = options.now ?? defaultNow;
  const yieldControl = options.yieldControl ?? defaultYieldControl;
  const startedAt = now();

  const startState = puzzle.cloneState(start);
  const goalState = puzzle.cloneState(goal);
  const startKey = puzzle.serialize(startState);
  const goalKey = puzzle.serialize(goalState);
  const startComponentKey = puzzle.componentKey(startState);
  const goalComponentKey = puzzle.componentKey(goalState);
  const moves = moveNotations(puzzle.moves);

  const queue: QueueEntry<State>[] = [
    { key: startKey, state: startState, depth: 0 },
  ];
  let head = 0;
  let expanded = 0;
  let activeExpansion = false;
  const states = new Map<string, State>([[startKey, startState]]);
  const parents = new Map<string, ParentLink<Move>>();
  const layerCounts: number[] = [1];
  const expandedByDepth: number[] = [];
  let foundGoal = startKey === goalKey;

  const layers = (componentComplete: boolean): readonly SearchLayer[] =>
    layerCounts.map((count, depth) => ({
      depth,
      count,
      complete:
        componentComplete ||
        depth === 0 ||
        (expandedByDepth[depth - 1] ?? 0) >= (layerCounts[depth - 1] ?? 0),
    }));

  const metrics = (): SearchMetrics => ({
    visited: states.size,
    expanded,
    frontier: queue.length - head + (activeExpansion ? 1 : 0),
    elapsedMs: Math.max(0, now() - startedAt),
    maxDepth: Math.max(0, layerCounts.length - 1),
  });

  const progress = (componentComplete: boolean): SearchProgress => ({
    startKey,
    goalKey,
    layers: layers(componentComplete),
    metrics: metrics(),
    componentComplete,
  });

  const base = <Complete extends boolean>(componentComplete: Complete) => ({
    startKey,
    goalKey,
    startComponentKey,
    goalComponentKey,
    layers: layers(componentComplete),
    metrics: metrics(),
    componentComplete,
  });

  const cancelled = (): SearchCancelled => ({
    status: "cancelled",
    ...base(false),
    reason: "Search cancelled.",
  });
  const timedOut = (): SearchTimeLimit => ({
    status: "time-limit",
    ...base(false),
    reason: `Search stopped after reaching the ${maxTimeMs} ms time limit.`,
    limitMs: maxTimeMs,
  });
  const nodeLimited = (): SearchNodeLimit => ({
    status: "node-limit",
    ...base(false),
    reason: `Search stopped after reaching the ${maxNodes} node limit.`,
    limit: maxNodes,
  });

  options.onProgress?.(progress(false));

  while (head < queue.length) {
    if (options.signal?.aborted) {
      return cancelled();
    }
    if (now() - startedAt >= maxTimeMs) {
      return timedOut();
    }

    const current = queue[head];
    head += 1;
    activeExpansion = true;

    for (const move of moves) {
      if (options.signal?.aborted) {
        return cancelled();
      }
      if (now() - startedAt >= maxTimeMs) {
        return timedOut();
      }

      const next = puzzle.applyMove(current.state, move);
      const key = puzzle.serialize(next);
      if (states.has(key)) {
        continue;
      }
      if (states.size >= maxNodes) {
        return nodeLimited();
      }

      const nextDepth = current.depth + 1;
      const stored = puzzle.cloneState(next);
      states.set(key, stored);
      parents.set(key, { prev: current.key, move });
      queue.push({ key, state: stored, depth: nextDepth });
      layerCounts[nextDepth] = (layerCounts[nextDepth] ?? 0) + 1;
      if (key === goalKey) {
        foundGoal = true;
      }
    }

    activeExpansion = false;
    expanded += 1;
    expandedByDepth[current.depth] = (expandedByDepth[current.depth] ?? 0) + 1;

    if (expanded % yieldEvery === 0 && head < queue.length) {
      options.onProgress?.(progress(false));
      await yieldControl();
    }
  }

  activeExpansion = false;
  options.onProgress?.(progress(true));

  if (!foundGoal) {
    const parityDetail =
      startComponentKey === goalComponentKey
        ? "No path exists in the generated state graph."
        : `Component mismatch (${startComponentKey} vs ${goalComponentKey}).`;
    return {
      status: "unreachable",
      ...base(true),
      reason: parityDetail,
    };
  }

  const reversedKeys: string[] = [goalKey];
  const reversedWord: Move[] = [];
  let trace = goalKey;
  while (trace !== startKey) {
    const link = parents.get(trace);
    if (!link) {
      throw new Error("Search parent chain is incomplete.");
    }
    reversedWord.push(link.move);
    trace = link.prev;
    reversedKeys.push(trace);
  }
  const pathKeys = reversedKeys.reverse();
  const word = reversedWord.reverse();
  const path = pathKeys.map((key) => {
    const state = states.get(key);
    if (!state) {
      throw new Error(`Search state "${key}" is missing.`);
    }
    return puzzle.cloneState(state);
  });

  return {
    status: "found",
    ...base(true),
    depth: word.length,
    word,
    path,
    pathKeys,
  };
};

export const search = searchPuzzle;
