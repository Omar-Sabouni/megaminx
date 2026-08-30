import type { SearchOutcome, SearchProgress } from "../core/search";
import type { EdgeState, Move } from "../core/types";
import type { PuzzleDefinition } from "../puzzles/types";
import {
  isModernSolverWorkerOutbound,
  WORKER_PROTOCOL_VERSION,
} from "../worker/messages";
import type {
  ModernSolverWorkerOutbound,
  SearchStartMessage,
  WorkerRequestId,
  WorkerSearchLimits,
} from "../worker/messages";

export class SearchClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SearchClientError";
  }
}

export class SearchCancelledError extends Error {
  constructor(message = "Search cancelled.") {
    super(message);
    this.name = "SearchCancelledError";
  }
}

export interface SearchRequestOptions {
  limits?: WorkerSearchLimits;
  onProgress?: (progress: SearchProgress) => void;
}

interface PendingSearch {
  requestId: WorkerRequestId;
  puzzle: PuzzleDefinition<EdgeState, Move>;
  startKey: string;
  goalKey: string;
  startComponentKey: string;
  goalComponentKey: string;
  watchdogTimer: number;
  resolve: (outcome: SearchOutcome<EdgeState, Move>) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SearchProgress) => void;
}

type WorkerFactory = () => Worker;

const DEFAULT_RESPONSE_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_GRACE_MS = 1_000;

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL("../worker/solverWorker.ts", import.meta.url), {
    type: "module",
  });

export class SearchClient {
  private worker: Worker | null;
  private pending: PendingSearch | null = null;
  private requestSequence = 0;
  private disposed = false;
  private recreationCount = 0;

  constructor(
    private readonly workerFactory: WorkerFactory = defaultWorkerFactory,
  ) {
    this.worker = this.createWorker();
  }

  get active(): boolean {
    return this.pending !== null;
  }

  search(
    puzzle: PuzzleDefinition<EdgeState, Move>,
    start: EdgeState,
    goal: EdgeState,
    options: SearchRequestOptions = {},
  ): Promise<SearchOutcome<EdgeState, Move>> {
    if (this.disposed) {
      return Promise.reject(
        new SearchClientError("Search client is disposed.", "DISPOSED", false),
      );
    }

    let startKey: string;
    let goalKey: string;
    let startComponentKey: string;
    let goalComponentKey: string;
    try {
      if (!puzzle.isState(start) || !puzzle.isState(goal)) {
        throw new TypeError(
          "Start and goal must be valid states for the selected puzzle.",
        );
      }
      startKey = puzzle.serialize(start);
      goalKey = puzzle.serialize(goal);
      startComponentKey = puzzle.componentKey(start);
      goalComponentKey = puzzle.componentKey(goal);
    } catch (error) {
      return Promise.reject(
        new SearchClientError(
          error instanceof Error
            ? error.message
            : "Could not prepare the search request.",
          "INVALID_SEARCH_REQUEST",
          false,
        ),
      );
    }

    this.supersedePending();
    // A user-initiated retry gets one fresh automatic worker recovery.
    this.recreationCount = 0;
    let worker: Worker;
    try {
      worker = this.worker ?? this.createAndStoreWorker();
    } catch (error) {
      return Promise.reject(
        new SearchClientError(
          error instanceof Error
            ? error.message
            : "Could not create the search worker.",
          "WORKER_CONSTRUCTION_FAILED",
          true,
        ),
      );
    }

    const requestId = `search-${Date.now().toString(36)}-${++this.requestSequence}`;
    const requestedTimeLimit = options.limits?.maxTimeMs;
    const responseTimeout =
      typeof requestedTimeLimit === "number" &&
      Number.isFinite(requestedTimeLimit) &&
      requestedTimeLimit > 0
        ? requestedTimeLimit + RESPONSE_TIMEOUT_GRACE_MS
        : DEFAULT_RESPONSE_TIMEOUT_MS;
    const message: SearchStartMessage<EdgeState> = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      type: "SEARCH_START",
      requestId,
      puzzleId: puzzle.id,
      puzzleVersion: puzzle.version,
      start,
      goal,
      ...(options.limits ? { limits: options.limits } : {}),
    };

    return new Promise((resolve, reject) => {
      const watchdogTimer = window.setTimeout(
        () => this.handleWatchdogTimeout(requestId),
        responseTimeout,
      );
      this.pending = {
        requestId,
        puzzle,
        startKey,
        goalKey,
        startComponentKey,
        goalComponentKey,
        watchdogTimer,
        resolve,
        reject,
        onProgress: options.onProgress,
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        this.pending = null;
        window.clearTimeout(watchdogTimer);
        this.discardWorker(worker);
        reject(
          new SearchClientError(
            error instanceof Error
              ? error.message
              : "Could not start the search worker.",
            "POST_MESSAGE_FAILED",
            true,
          ),
        );
      }
    });
  }

  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    // Clear the active slot before posting the cancellation. A worker may race
    // with this call and return a valid result synchronously; that result must
    // never resolve work the caller has already cancelled.
    this.pending = null;
    this.clearWatchdog(pending);
    try {
      this.worker?.postMessage({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        type: "SEARCH_CANCEL",
        requestId: pending.requestId,
      });
    } catch {
      if (this.recreationCount < 1) this.replaceWorker();
    }
    pending.reject(new SearchCancelledError());
  }

  private supersedePending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.clearWatchdog(pending);
    try {
      this.worker?.postMessage({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        type: "SEARCH_CANCEL",
        requestId: pending.requestId,
      });
    } catch {
      if (this.recreationCount < 1) this.replaceWorker();
    }
    pending.reject(
      new SearchCancelledError("Search superseded by a newer request."),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.clearWatchdog(pending);
      pending.reject(new SearchCancelledError("Search client disposed."));
    }
    this.discardWorker();
  }

  private createWorker(): Worker {
    const worker = this.workerFactory();
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onWorkerError);
    worker.addEventListener("messageerror", this.onMessageError);
    return worker;
  }

  private createAndStoreWorker(): Worker {
    const worker = this.createWorker();
    this.worker = worker;
    return worker;
  }

  private discardWorker(expected?: Worker): void {
    if (expected && this.worker !== expected) return;
    this.worker?.terminate();
    this.worker = null;
  }

  private replaceWorker(): void {
    this.discardWorker();
    if (this.disposed) return;
    try {
      this.createAndStoreWorker();
      this.recreationCount += 1;
    } catch {
      // The next explicit Retry reports construction failure through search().
    }
  }

  private finishPending(
    message: Extract<
      ModernSolverWorkerOutbound,
      { type: "SEARCH_RESULT" | "SEARCH_FAILURE" }
    >,
  ): PendingSearch | null {
    const pending = this.pending;
    if (!pending || pending.requestId !== message.requestId) return null;
    this.pending = null;
    this.clearWatchdog(pending);
    return pending;
  }

  private clearWatchdog(pending: PendingSearch): void {
    window.clearTimeout(pending.watchdogTimer);
  }

  private handleWatchdogTimeout(requestId: WorkerRequestId): void {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId) return;
    this.pending = null;
    this.clearWatchdog(pending);
    pending.reject(
      new SearchClientError(
        "Search worker did not return a terminal response in time.",
        "WORKER_TIMEOUT",
        true,
      ),
    );
    this.replaceWorker();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.currentTarget !== this.worker) return;
    const pending = this.pending;
    if (!pending) return;
    if (!isModernSolverWorkerOutbound(event.data, pending.puzzle)) {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "requestId" in event.data &&
        event.data.requestId === pending.requestId
      ) {
        this.failWorker(
          "Search worker returned an invalid protocol message.",
          "PROTOCOL_ERROR",
        );
      }
      return;
    }
    const message = event.data;
    if (pending.requestId !== message.requestId) return;
    if (
      (message.type !== "SEARCH_FAILURE" &&
        (message.startKey !== pending.startKey ||
          message.goalKey !== pending.goalKey)) ||
      (message.type === "SEARCH_FAILURE" &&
        ((message.startKey !== undefined &&
          message.startKey !== pending.startKey) ||
          (message.goalKey !== undefined &&
            message.goalKey !== pending.goalKey)))
    ) {
      this.failWorker(
        "Search worker returned mismatched state anchors.",
        "ANCHOR_MISMATCH",
      );
      return;
    }

    if (
      message.type === "SEARCH_RESULT" &&
      (message.result.startComponentKey !== pending.startComponentKey ||
        message.result.goalComponentKey !== pending.goalComponentKey)
    ) {
      this.failWorker(
        "Search worker returned mismatched component anchors.",
        "ANCHOR_MISMATCH",
      );
      return;
    }

    if (message.type === "SEARCH_PROGRESS") {
      try {
        pending.onProgress?.(message.progress);
      } catch (error) {
        this.pending = null;
        this.clearWatchdog(pending);
        try {
          this.worker?.postMessage({
            protocolVersion: WORKER_PROTOCOL_VERSION,
            type: "SEARCH_CANCEL",
            requestId: pending.requestId,
          });
        } catch {
          this.discardWorker();
        }
        pending.reject(
          new SearchClientError(
            error instanceof Error
              ? error.message
              : "Search progress handler failed.",
            "PROGRESS_HANDLER_ERROR",
            false,
          ),
        );
      }
      return;
    }

    const completed = this.finishPending(message);
    if (!completed) return;
    if (message.type === "SEARCH_RESULT") {
      completed.resolve(message.result);
      return;
    }
    completed.reject(
      new SearchClientError(
        message.error.message,
        message.error.code,
        message.error.retryable,
      ),
    );
  };

  private readonly onWorkerError = (event: ErrorEvent): void => {
    if (event.currentTarget !== this.worker) return;
    event.preventDefault();
    this.failWorker(
      event.message || "The search worker stopped unexpectedly.",
      "WORKER_ERROR",
    );
  };

  private readonly onMessageError = (event: MessageEvent<unknown>): void => {
    if (event.currentTarget !== this.worker) return;
    this.failWorker(
      "The search worker returned an unreadable message.",
      "MESSAGE_ERROR",
    );
  };

  private failWorker(message: string, code: string): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.clearWatchdog(pending);
      pending.reject(new SearchClientError(message, code, true));
    }
    if (this.recreationCount < 1) this.replaceWorker();
    else this.discardWorker();
  }
}
