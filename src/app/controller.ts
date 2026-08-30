import { analyzeInvariants } from "../core/invariants";
import { formatWord, previewWord } from "../core/word";
import type { WordPreviewResult } from "../core/word";
import { generateScramble } from "../core/scramble";
import type { GeneratedScramble } from "../core/scramble";
import type { SearchOutcome, SearchProgress } from "../core/search";
import type { EdgeState, Move } from "../core/types";
import { validateReachableInput } from "../core/reachability";
import { TOP_LAYER_EDGES } from "../puzzles/topLayerEdges";
import { decodeSessionHash, encodeSessionHash } from "../services/url-session";
import type { DecodedSession } from "../services/url-session";
import {
  SearchCancelledError,
  SearchClient,
  SearchClientError,
} from "../services/search-client";
import type { TopLayerScene } from "../ui/scene";
import { WorkspaceView } from "../ui/workspace";
import type { StatusTone } from "../ui/workspace";
import { ActionQueue } from "./actionQueue";
import { PlaybackController } from "./playback";
import { SessionModel } from "./session";

const BASE_ANIMATION_MS = 280;
const URL_UPDATE_DELAY_MS = 120;

const isReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const formatElapsed = (milliseconds: number): string =>
  milliseconds < 1 ? "<1 ms" : `${Math.round(milliseconds)} ms`;

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(
    target.closest(
      "input, textarea, select, button, a, summary, [contenteditable='true'], [role='button']",
    ),
  );

const isSessionFragment = (hash: string): boolean => {
  if (hash === "" || hash === "#") return true;
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  return ["v", "p", "state", "word", "seed", "len"].some((field) =>
    params.has(field),
  );
};

const renderStateTokens = (
  target: HTMLElement,
  state: EdgeState,
  compact = false,
): void => {
  const punctuation = (text: string): Node => {
    const mark = document.createElement("span");
    mark.className = "sr-only";
    mark.textContent = text;
    return mark;
  };
  const nodes: Node[] = [punctuation("[")];
  state.forEach((edge, index) => {
    if (index > 0) nodes.push(punctuation(", "));
    const token = document.createElement("span");
    token.className = `state-piece piece-${edge.id}${edge.flipped ? " flipped" : ""}${compact ? " compact" : ""}`;
    token.textContent = `${edge.id}${edge.flipped ? "'" : ""}`;
    nodes.push(token);
  });
  nodes.push(punctuation("]"));
  target.replaceChildren(...nodes);
};

export class MegaminxApp {
  private readonly puzzle = TOP_LAYER_EDGES;
  private readonly view: WorkspaceView;
  private readonly session: SessionModel<EdgeState, Move>;
  private readonly playback: PlaybackController<EdgeState, Move>;
  private readonly actionQueue: ActionQueue;
  private readonly events = new AbortController();
  private searchClient: SearchClient | null = null;
  private scene: TopLayerScene | null = null;
  private analysis: SearchOutcome<EdgeState, Move> | null = null;
  private searchProgress: SearchProgress | null = null;
  private wordPreview: WordPreviewResult<EdgeState, Move> | null = null;
  private lastScramble: GeneratedScramble<Move> | null = null;
  private searchGeneration = 0;
  private isSearching = false;
  private isSceneBusy = false;
  private urlTimer: number | null = null;
  private lastWrittenHash = "";
  private disposed = false;

  constructor(root: HTMLElement) {
    this.view = new WorkspaceView(root);
    const decoded = decodeSessionHash(
      isSessionFragment(window.location.hash) ? window.location.hash : "",
      this.puzzle,
    );
    this.session = new SessionModel(this.puzzle, decoded.state);
    this.actionQueue = new ActionQueue((busy) => {
      this.isSceneBusy = busy;
      this.render();
    });
    this.playback = new PlaybackController(this.session, {
      transition: async (state, options) => {
        this.isSceneBusy = true;
        this.render();
        try {
          await this.transitionScene(state, options);
        } finally {
          this.isSceneBusy = false;
          this.render();
          this.scheduleUrlUpdate();
        }
      },
      onChange: () => {
        this.render();
        this.scheduleUrlUpdate();
      },
      onComplete: (moveCount) => {
        this.setStatus(`Playback complete (${moveCount} moves).`, "success");
      },
      getSpeed: () => Number(this.view.elements.speedSelect.value) || 1,
      reducedMotion: isReducedMotion,
    });

    this.bindEvents();
    this.hydrateDecodedSession(decoded, false);
    // Hydration establishes the normal ready status first, so construction
    // failures remain visible instead of being immediately overwritten.
    this.createSearchClient();
    this.render();
    void this.initializeScene();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.abort();
    if (this.urlTimer !== null) window.clearTimeout(this.urlTimer);
    this.playback.stop();
    this.searchClient?.dispose();
    this.scene?.dispose();
  }

  private createSearchClient(): void {
    try {
      this.searchClient?.dispose();
      this.searchClient = new SearchClient();
    } catch (error) {
      this.searchClient = null;
      this.setStatus(
        error instanceof Error
          ? `Search worker unavailable: ${error.message}`
          : "Search worker unavailable.",
        "error",
      );
    }
  }

  private async initializeScene(): Promise<void> {
    try {
      const { TopLayerScene } = await import("../ui/scene");
      if (this.disposed) return;
      const scene = new TopLayerScene(this.view.elements.sceneHost, {
        canvasLabel: "Interactive 3D Megaminx top-layer edge model",
        canvasDescriptionId: "sceneDescription",
        respectReducedMotion: true,
      });
      this.scene = scene;
      if (!scene.available) {
        this.view.setSceneUnavailable(
          "WebGL could not start. Text controls and exact analysis are still available.",
        );
        return;
      }
      await scene.setState(this.session.currentState(), { animate: false });
    } catch (error) {
      this.view.setSceneUnavailable(
        error instanceof Error
          ? error.message
          : "The 3D module could not be loaded.",
      );
    }
  }

  private bindEvents(): void {
    const { elements } = this.view;
    const signal = this.events.signal;

    elements.moveButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const move = button.dataset.move as Move;
          this.applyMove(move);
        },
        { signal },
      );
    });
    elements.undoButton.addEventListener("click", () => this.undo(), {
      signal,
    });
    elements.redoButton.addEventListener("click", () => this.redo(), {
      signal,
    });
    elements.resetButton.addEventListener("click", () => this.resetSolved(), {
      signal,
    });
    elements.resetViewButton.addEventListener(
      "click",
      () => this.scene?.resetView(),
      { signal },
    );
    elements.stateForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.loadStateInput();
      },
      { signal },
    );
    elements.stateInput.addEventListener(
      "input",
      () => {
        elements.stateInput.removeAttribute("aria-invalid");
        elements.stateError.textContent = "";
      },
      { signal },
    );

    elements.wordInput.addEventListener(
      "input",
      () => {
        this.updateWordPreview();
        this.scheduleUrlUpdate();
      },
      { signal },
    );
    elements.wordForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.applyWord();
      },
      { signal },
    );
    elements.replayWordButton.addEventListener(
      "click",
      () => this.replayDraftWord(),
      { signal },
    );

    elements.scrambleForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.loadScramble();
      },
      { signal },
    );
    elements.seedInput.addEventListener(
      "input",
      () => {
        this.clearFieldError(elements.seedInput, elements.scrambleError);
        this.scheduleUrlUpdate();
      },
      { signal },
    );
    elements.scrambleLength.addEventListener(
      "input",
      () => {
        this.clearFieldError(elements.scrambleLength, elements.scrambleError);
        this.scheduleUrlUpdate();
      },
      { signal },
    );
    elements.newSeedButton.addEventListener(
      "click",
      () => this.createRandomSeed(),
      { signal },
    );
    elements.replayScrambleButton.addEventListener(
      "click",
      () => this.replayScramble(),
      { signal },
    );

    elements.solveButton.addEventListener(
      "click",
      () => void this.analyzeState(),
      { signal },
    );
    elements.cancelSearchButton.addEventListener(
      "click",
      () => this.cancelSearch(),
      { signal },
    );
    elements.playSolutionButton.addEventListener(
      "click",
      () => this.playSolution(),
      { signal },
    );
    elements.copySolutionButton.addEventListener(
      "click",
      () => void this.copySolution(),
      { signal },
    );

    elements.playPauseButton.addEventListener(
      "click",
      () => this.playback.toggle(),
      { signal },
    );
    elements.stepBackButton.addEventListener(
      "click",
      () => void this.playback.stepBackward(),
      { signal },
    );
    elements.stepForwardButton.addEventListener(
      "click",
      () => void this.playback.stepForward(),
      { signal },
    );
    elements.restartPlaybackButton.addEventListener(
      "click",
      () => void this.playback.restart(false),
      { signal },
    );
    elements.exitPlaybackButton.addEventListener(
      "click",
      () => this.exitPlayback(),
      { signal },
    );
    elements.speedSelect.addEventListener("change", () => this.render(), {
      signal,
    });

    elements.shareButton.addEventListener(
      "click",
      () => void this.shareWorkspace(),
      { signal },
    );
    elements.closeShareDialog.addEventListener(
      "click",
      () => elements.shareDialog.close(),
      { signal },
    );

    window.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("hashchange", this.onHashChange, { signal });
  }

  private applyMove(move: Move): void {
    if (this.controlsLocked()) return;
    this.prepareManualMutation();
    void this.actionQueue
      .enqueue(async () => {
        const next = this.session.commitMove(move);
        this.render();
        await this.transitionScene(next, {
          animate: !isReducedMotion(),
          durationMs: BASE_ANIMATION_MS,
        });
        this.setStatus(`${move} applied.`, "success");
        this.afterStateMutation();
      })
      .catch((error: unknown) => this.reportActionError(error));
  }

  private undo(): void {
    if (this.controlsLocked()) return;
    this.prepareManualMutation();
    const state = this.session.undo();
    if (!state) return;
    void this.transitionAndFinish(state, "Undo.");
  }

  private redo(): void {
    if (this.controlsLocked()) return;
    this.prepareManualMutation();
    const state = this.session.redo();
    if (!state) return;
    void this.transitionAndFinish(state, "Redo.");
  }

  private resetSolved(): void {
    if (this.controlsLocked()) return;
    this.prepareManualMutation();
    const state = this.session.replaceRoot(this.puzzle.solvedState);
    void this.transitionAndFinish(state, "Solved state loaded.");
  }

  private loadStateInput(): void {
    if (this.controlsLocked()) return;
    const result = this.puzzle.parseState(this.view.elements.stateInput.value);
    if (!result.ok) {
      this.showFieldError(
        this.view.elements.stateInput,
        this.view.elements.stateError,
        result.error.message,
      );
      return;
    }

    this.clearFieldError(
      this.view.elements.stateInput,
      this.view.elements.stateError,
    );
    this.prepareManualMutation();
    const state = this.session.replaceRoot(result.value);
    const reachability = validateReachableInput(result.value);
    const message = reachability.ok
      ? "State loaded."
      : `State loaded from an unreachable component: ${reachability.reason ?? "component mismatch"}`;
    void this.transitionAndFinish(
      state,
      message,
      reachability.ok ? "success" : "warning",
      false,
    );
  }

  private applyWord(): void {
    if (this.controlsLocked()) return;
    this.updateWordPreview();
    if (!this.wordPreview?.ok) return;
    const { moves } = this.wordPreview.value;
    if (moves.length === 0) {
      this.setStatus("The identity word leaves the state unchanged.", "info");
      return;
    }
    this.prepareManualMutation();
    const state = this.session.commitWord(moves);
    void this.transitionAndFinish(
      state,
      `${moves.length} moves applied.`,
      "success",
      false,
    );
  }

  private replayDraftWord(): void {
    if (this.controlsLocked()) return;
    this.updateWordPreview();
    if (!this.wordPreview?.ok || this.wordPreview.value.moves.length === 0)
      return;
    this.analysis = null;
    this.playback.start(
      this.wordPreview.value.moves,
      "word",
      "Word replay",
      false,
    );
    this.setStatus("Word ready at step 0.", "info");
  }

  private loadScramble(): void {
    if (this.controlsLocked()) return;
    const result = generateScramble(
      this.puzzle,
      this.view.elements.seedInput.value,
      this.view.elements.scrambleLength.value,
    );
    if (!result.ok) {
      if (result.error.code === "invalid-seed") {
        this.showFieldError(
          this.view.elements.seedInput,
          this.view.elements.scrambleError,
          result.error.message,
        );
      } else if (result.error.code === "invalid-length") {
        this.showFieldError(
          this.view.elements.scrambleLength,
          this.view.elements.scrambleError,
          result.error.message,
        );
      } else {
        this.setStatus(result.error.message, "error");
      }
      return;
    }

    this.clearFieldError(
      this.view.elements.seedInput,
      this.view.elements.scrambleError,
    );
    this.clearFieldError(
      this.view.elements.scrambleLength,
      this.view.elements.scrambleError,
    );
    this.prepareManualMutation();
    this.lastScramble = result.value;
    this.view.elements.seedInput.value = result.value.seed;
    this.view.elements.scrambleLength.value = String(result.value.length);
    this.view.elements.scrambleWord.textContent = result.value.normalized;

    let state = this.puzzle.cloneState(this.puzzle.solvedState);
    for (const move of result.value.moves)
      state = this.puzzle.applyMove(state, move);
    state = this.session.replaceRoot(state);
    // Commit the generated state and its seed as one shareable snapshot before
    // the scene transition begins. This prevents a pending form-input update
    // from briefly exposing the new seed with the previous puzzle state.
    this.render();
    this.flushUrlUpdate();
    void this.transitionAndFinish(
      state,
      `Scramble loaded (${result.value.length} moves).`,
      "success",
      false,
      true,
    );
  }

  private replayScramble(): void {
    if (this.controlsLocked() || !this.lastScramble) return;
    this.invalidateAnalysis();
    const state = this.session.replaceRoot(this.puzzle.solvedState);
    void this.transitionScene(state, { animate: false, durationMs: 0 }).then(
      () => {
        if (!this.lastScramble) return;
        this.playback.start(
          this.lastScramble.moves,
          "scramble",
          "Scramble replay",
          false,
        );
        this.setStatus("Scramble ready at step 0.", "info");
        this.render();
        this.scheduleUrlUpdate();
      },
    );
  }

  private createRandomSeed(): void {
    try {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      this.view.elements.seedInput.value = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      this.clearFieldError(
        this.view.elements.seedInput,
        this.view.elements.scrambleError,
      );
      this.scheduleUrlUpdate();
      this.setStatus("Scramble key changed.", "info");
    } catch {
      this.setStatus(
        "This browser could not create a random scramble key.",
        "warning",
      );
    }
  }

  private async analyzeState(): Promise<void> {
    if (
      this.isSearching ||
      this.session.snapshot().playback ||
      this.isSceneBusy
    )
      return;
    if (!this.searchClient) this.createSearchClient();
    const client = this.searchClient;
    if (!client) {
      this.setStatus(
        "The search worker is unavailable. Reload or try again.",
        "error",
      );
      return;
    }

    const start = this.session.currentState();
    const startKey = this.puzzle.serialize(start);
    const generation = ++this.searchGeneration;
    this.isSearching = true;
    this.analysis = null;
    this.searchProgress = null;
    this.render();
    this.setStatus("Searching…", "info");

    try {
      const outcome = await client.search(
        this.puzzle,
        start,
        this.puzzle.solvedState,
        {
          limits: { maxNodes: 20_000, maxTimeMs: 5_000, yieldEvery: 64 },
          onProgress: (progress) => {
            if (generation !== this.searchGeneration) return;
            this.searchProgress = progress;
            this.renderAnalysisStatus();
          },
        },
      );
      if (
        generation !== this.searchGeneration ||
        this.session.currentKey() !== startKey
      )
        return;
      this.isSearching = false;
      this.searchProgress = null;
      if (outcome.status === "cancelled") {
        this.analysis = null;
        this.setStatus("Analysis cancelled.", "info");
      } else {
        this.analysis = outcome;
        this.setStatus(
          outcome.status === "found"
            ? `Solved in ${outcome.depth} move${outcome.depth === 1 ? "" : "s"}.`
            : outcome.status === "unreachable"
              ? "Analysis complete: solved lies in a different parity component."
              : outcome.reason,
          outcome.status === "found"
            ? "success"
            : outcome.status === "unreachable"
              ? "warning"
              : "error",
        );
      }
      this.render();
    } catch (error) {
      if (generation !== this.searchGeneration) return;
      this.isSearching = false;
      this.searchProgress = null;
      if (error instanceof SearchCancelledError) {
        this.setStatus("Analysis cancelled.", "info");
      } else {
        const message =
          error instanceof SearchClientError || error instanceof Error
            ? error.message
            : "Unknown worker failure.";
        this.setStatus(`Analysis failed: ${message} Try again.`, "error");
      }
      this.render();
    }
  }

  private cancelSearch(): void {
    if (!this.isSearching) return;
    this.searchClient?.cancel();
    this.setStatus("Cancelling analysis…", "info");
  }

  private playSolution(): void {
    const result = this.analysis;
    if (
      !result ||
      result.status !== "found" ||
      result.word.length === 0 ||
      this.session.currentKey() !== result.startKey ||
      this.session.snapshot().playback
    ) {
      return;
    }
    this.playback.start(result.word, "solution", "Shortest solution", true);
    this.setStatus("Playing solution.", "success");
  }

  private exitPlayback(): void {
    const hadPlayback = this.session.snapshot().playback !== null;
    this.playback.stop();
    if (
      hadPlayback &&
      this.analysis &&
      this.session.currentKey() !== this.analysis.startKey
    ) {
      this.analysis = null;
    }
    this.setStatus("Playback stopped.", "info");
    this.render();
    this.scheduleUrlUpdate();
  }

  private async copySolution(): Promise<void> {
    if (
      !this.analysis ||
      this.analysis.status !== "found" ||
      this.analysis.word.length === 0
    )
      return;
    await this.copyText(
      formatWord(this.analysis.word),
      "Solution word copied.",
    );
  }

  private async shareWorkspace(): Promise<void> {
    const link = this.flushUrlUpdate();
    await this.copyText(link, "Workspace link copied.", true);
  }

  private async copyText(
    text: string,
    success: string,
    showLinkFallback = false,
  ): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      this.setStatus(success, "success");
    } catch {
      if (showLinkFallback) {
        this.view.elements.shareLinkInput.value = text;
        this.view.elements.shareDialog.showModal();
        this.view.elements.shareLinkInput.select();
      } else {
        this.setStatus(
          "Clipboard access was denied. Select the word and copy it manually.",
          "warning",
        );
      }
    }
  }

  private transitionAndFinish(
    state: EdgeState,
    message: string,
    tone: StatusTone = "success",
    animate = true,
    keepScramble = false,
  ): Promise<void> {
    return this.actionQueue
      .enqueue(async () => {
        this.render();
        await this.transitionScene(state, {
          animate: animate && !isReducedMotion(),
          durationMs: BASE_ANIMATION_MS,
        });
        this.setStatus(message, tone);
        this.afterStateMutation(keepScramble);
      })
      .catch((error: unknown) => this.reportActionError(error));
  }

  private async transitionScene(
    state: EdgeState,
    options: { animate: boolean; durationMs: number },
  ): Promise<void> {
    if (!this.scene?.available) return;
    try {
      await this.scene.setState(state, {
        ...options,
        respectReducedMotion: true,
      });
    } catch (error) {
      try {
        await this.scene.setState(state, { animate: false });
      } catch {
        this.view.setSceneUnavailable(
          error instanceof Error
            ? error.message
            : "The 3D preview stopped responding.",
        );
      }
    }
  }

  private prepareManualMutation(): void {
    this.playback.stop();
    this.invalidateAnalysis();
    this.lastScramble = null;
  }

  private invalidateAnalysis(): void {
    this.searchGeneration += 1;
    if (this.isSearching) this.searchClient?.cancel();
    this.isSearching = false;
    this.searchProgress = null;
    this.analysis = null;
  }

  private afterStateMutation(keepScramble = false): void {
    if (!keepScramble) {
      this.lastScramble = null;
    }
    this.render();
    this.scheduleUrlUpdate();
  }

  private controlsLocked(): boolean {
    return this.isSceneBusy || this.session.snapshot().playback !== null;
  }

  private updateWordPreview(): void {
    const { elements } = this.view;
    this.wordPreview = previewWord(
      elements.wordInput.value,
      this.puzzle,
      this.session.currentState(),
    );
    if (!this.wordPreview.ok) {
      this.showFieldError(
        elements.wordInput,
        elements.wordError,
        this.wordPreview.error.message,
      );
      elements.wordPreview.textContent =
        "Fix the word above to preview its target state.";
    } else {
      this.clearFieldError(elements.wordInput, elements.wordError);
      const { moves, state } = this.wordPreview.value;
      elements.wordPreview.textContent =
        moves.length === 0
          ? ""
          : `${moves.length} move${moves.length === 1 ? "" : "s"}, ends at ${this.puzzle.formatState(state)}`;
    }
    this.renderControls();
  }

  private render(): void {
    if (this.disposed) return;
    const snapshot = this.session.snapshot();
    const { elements } = this.view;
    const stateLabel = this.puzzle.formatState(snapshot.currentState);
    elements.currentState.value = stateLabel;
    renderStateTokens(elements.currentState, snapshot.currentState);
    if (document.activeElement !== elements.stateInput)
      elements.stateInput.value = stateLabel;

    this.renderInvariants(snapshot.currentState);
    this.renderMoveLog();
    this.updateWordPreview();
    this.renderPlayback();
    this.renderAnalysis();
    this.renderControls();
  }

  private renderInvariants(state: EdgeState): void {
    const summary = analyzeInvariants(state);
    const reachability = validateReachableInput(state);
    const readings = [
      {
        label: `Flip parity: ${summary.orientationParity === 0 ? "even" : "odd"}`,
        match: summary.orientationParity === 0,
      },
      {
        label: `Permutation: ${summary.permutationParity === 0 ? "even" : "odd"}`,
        match: summary.permutationParity === 0,
      },
      {
        label: reachability.ok
          ? "Solved component"
          : `Component ${reachability.componentKey}`,
        match: reachability.ok,
      },
    ];
    this.view.elements.invariantList.replaceChildren(
      ...readings.map((reading) => {
        const item = document.createElement("li");
        item.className = `invariant-chip ${reading.match ? "match" : "mismatch"}`;
        item.textContent = reading.label;
        return item;
      }),
    );
  }

  private renderMoveLog(): void {
    const snapshot = this.session.snapshot();
    const items: HTMLLIElement[] = [];
    if (snapshot.history.moves.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No moves yet";
      items.push(empty);
    } else {
      snapshot.history.moves.forEach((move, index) => {
        const item = document.createElement("li");
        item.textContent = `${index + 1}:${move}`;
        if (index >= snapshot.history.cursor) item.className = "future";
        items.push(item);
      });
    }
    this.view.elements.moveLog.replaceChildren(...items);
  }

  private renderPlayback(): void {
    const { elements } = this.view;
    const playback = this.session.snapshot().playback;
    elements.playbackPanel.hidden = !playback;
    if (!playback) return;
    elements.playbackLabel.textContent = playback.label;
    const nextMove =
      playback.index < playback.word.length
        ? playback.word[playback.index]
        : "done";
    elements.playbackProgress.textContent = `Step ${playback.index}/${playback.word.length}. Next: ${nextMove}`;
    elements.playPauseButton.textContent =
      playback.index >= playback.word.length
        ? "Replay"
        : playback.isPlaying
          ? "Pause"
          : "Play";
    elements.stepBackButton.disabled =
      playback.isPlaying || playback.index === 0 || this.isSceneBusy;
    elements.stepForwardButton.disabled =
      playback.isPlaying ||
      playback.index >= playback.word.length ||
      this.isSceneBusy;
    elements.restartPlaybackButton.disabled = this.isSceneBusy;
  }

  private renderAnalysisStatus(): void {
    const { analysisStatus } = this.view.elements;
    if (this.isSearching) {
      const metrics = this.searchProgress?.metrics;
      analysisStatus.textContent = metrics
        ? `Exploring… ${metrics.visited} states discovered, ${metrics.expanded} expanded.`
        : "Starting the search worker…";
    } else if (!this.analysis) {
      analysisStatus.textContent = "";
    }
  }

  private renderAnalysis(): void {
    const { elements } = this.view;
    this.renderAnalysisStatus();
    const result = this.analysis;
    elements.analysisEmpty.hidden = result !== null || this.isSearching;
    elements.analysisResult.hidden = result === null;
    if (!result) return;

    const found = result.status === "found" ? result : null;
    elements.solutionDepth.textContent = found ? String(found.depth) : "—";
    elements.solutionWord.textContent =
      result.status === "found"
        ? result.word.length > 0
          ? formatWord(result.word)
          : "Identity — already solved"
        : result.reason;
    elements.copySolutionButton.hidden = !found || found.word.length === 0;
    elements.playSolutionButton.hidden = !found || found.word.length === 0;
    elements.playSolutionButton.disabled =
      !found ||
      found.word.length === 0 ||
      this.session.currentKey() !== found.startKey ||
      this.session.snapshot().playback !== null ||
      this.isSceneBusy;

    if (found) {
      elements.analysisStatus.textContent =
        found.depth === 0
          ? "Already solved."
          : `Solved in ${found.depth} move${found.depth === 1 ? "" : "s"}.`;
      this.renderPath(found);
    } else if (result.status !== "found") {
      elements.analysisStatus.textContent = result.reason;
      elements.pathList.replaceChildren();
    }
    this.renderLayers(result);
    this.renderMetrics(result);
  }

  private renderPath(
    result: Extract<SearchOutcome<EdgeState, Move>, { status: "found" }>,
  ): void {
    const playback = this.session.snapshot().playback;
    const canStart =
      result.word.length > 0 &&
      playback === null &&
      this.session.currentKey() === result.startKey;
    const canSeek =
      playback?.source === "solution" &&
      playback.anchorKey === result.startKey &&
      !playback.isPlaying &&
      !this.isSceneBusy;
    const items = result.path.map((state, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "path-step";
      button.dataset.pathIndex = String(index);
      const isCurrent =
        playback?.source === "solution"
          ? playback.index === index
          : index === 0 && this.session.currentKey() === result.startKey;
      if (isCurrent) {
        button.classList.add("current");
        button.setAttribute("aria-current", "step");
      }
      button.disabled = !(canStart || canSeek) || this.isSceneBusy;
      const move = index === 0 ? "Start" : result.word[index - 1];
      const label = this.puzzle.formatState(state);
      button.setAttribute(
        "aria-label",
        `Step ${index}, ${move}, state ${label}`,
      );
      const title = document.createElement("strong");
      title.textContent = index === 0 ? "0: start" : `${index}: ${move}`;
      const stateText = document.createElement("small");
      stateText.className = "path-state";
      renderStateTokens(stateText, state, true);
      button.append(title, stateText);
      button.addEventListener(
        "click",
        () => void this.seekSolutionStep(result, index),
      );
      item.append(button);
      return item;
    });
    this.view.elements.pathList.replaceChildren(...items);
  }

  private async seekSolutionStep(
    result: Extract<SearchOutcome<EdgeState, Move>, { status: "found" }>,
    index: number,
  ): Promise<void> {
    let playback = this.session.snapshot().playback;
    if (!playback) {
      if (
        this.session.currentKey() !== result.startKey ||
        result.word.length === 0
      )
        return;
      this.playback.start(result.word, "solution", "Shortest solution", false);
      playback = this.session.snapshot().playback;
      this.setStatus("Solution ready at step 0.", "info");
    }
    if (
      playback?.source !== "solution" ||
      playback.anchorKey !== result.startKey ||
      playback.isPlaying
    ) {
      return;
    }
    await this.playback.seek(index);
    this.view.elements.pathList
      .querySelector<HTMLButtonElement>(`[data-path-index="${index}"]`)
      ?.focus();
  }

  private renderLayers(result: SearchOutcome<EdgeState, Move>): void {
    const { elements } = this.view;
    const layers = result.layers;
    const total = layers.reduce((sum, layer) => sum + layer.count, 0);
    const goalDepth = result.status === "found" ? result.depth : null;
    const maxCount = Math.max(1, ...layers.map((layer) => layer.count));
    elements.histogram.style.setProperty(
      "--layer-count",
      String(Math.max(1, layers.length)),
    );
    elements.histogram.replaceChildren(
      ...layers.map((layer) => {
        const column = document.createElement("div");
        column.className = "layer-bar-wrap";
        column.dataset.depth = String(layer.depth);
        column.setAttribute("aria-hidden", "true");

        const count = document.createElement("span");
        count.className = "layer-value";
        count.textContent = String(layer.count);

        const bar = document.createElement("span");
        bar.className = `layer-bar${goalDepth === layer.depth ? " goal" : ""}${layer.complete ? "" : " partial"}`;
        bar.style.height = `${Math.max(4, (layer.count / maxCount) * 160)}px`;

        const depth = document.createElement("span");
        depth.className = "layer-depth";
        depth.textContent = `d${layer.depth}`;
        column.append(count, bar, depth);
        return column;
      }),
    );
    const farthest = layers.at(-1)?.depth ?? 0;
    const goalNote =
      goalDepth !== null
        ? ` This one is ${goalDepth} away.`
        : result.status === "unreachable"
          ? " Solved can't be reached from here."
          : "";
    elements.histogramCaption.textContent = `${total} positions${result.componentComplete ? `, none more than ${farthest} moves away` : " found so far"}.${goalNote}`;

    elements.histogramTableBody.replaceChildren(
      ...layers.map((layer) => {
        const row = document.createElement("tr");
        const depth = document.createElement("th");
        depth.scope = "row";
        depth.textContent = `d${layer.depth}`;
        const count = document.createElement("td");
        count.textContent = String(layer.count);
        const status = document.createElement("td");
        status.textContent = `${layer.complete ? "Complete" : "Partial"}${goalDepth === layer.depth ? " (solved)" : ""}`;
        row.append(depth, count, status);
        return row;
      }),
    );
  }

  private renderMetrics(result: SearchOutcome<EdgeState, Move>): void {
    const values = [
      ["Visited", String(result.metrics.visited)],
      ["Expanded", String(result.metrics.expanded)],
      ["Frontier", String(result.metrics.frontier)],
      ["Elapsed", formatElapsed(result.metrics.elapsedMs)],
    ];
    const nodes: HTMLElement[] = [];
    values.forEach(([label, value]) => {
      const wrap = document.createElement("div");
      wrap.className = "metric";
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      wrap.append(term, detail);
      nodes.push(wrap);
    });
    this.view.elements.metrics.replaceChildren(...nodes);
  }

  private renderControls(): void {
    const { elements } = this.view;
    const playback = this.session.snapshot().playback;
    const locked = this.isSceneBusy || playback !== null;
    elements.moveButtons.forEach((button) => (button.disabled = locked));
    elements.undoButton.disabled = locked || !this.session.canUndo();
    elements.redoButton.disabled = locked || !this.session.canRedo();
    elements.resetButton.disabled = locked;
    elements.stateForm
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = locked));
    elements.scrambleForm
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = locked));
    elements.applyWordButton.disabled =
      locked ||
      !this.wordPreview?.ok ||
      this.wordPreview.value.moves.length === 0;
    elements.replayWordButton.disabled =
      locked ||
      !this.wordPreview?.ok ||
      this.wordPreview.value.moves.length === 0;
    elements.replayScrambleButton.disabled =
      locked || this.lastScramble === null;
    elements.solveButton.disabled =
      this.isSearching || this.isSceneBusy || playback !== null;
    elements.solveButton.textContent = this.analysis
      ? "Solve again"
      : "Find the shortest solution";
    elements.cancelSearchButton.hidden = !this.isSearching;
    elements.shareButton.disabled = false;
  }

  private showFieldError(
    input: HTMLInputElement | HTMLTextAreaElement,
    error: HTMLElement,
    message: string,
  ): void {
    input.setAttribute("aria-invalid", "true");
    error.textContent = message;
  }

  private clearFieldError(
    input: HTMLInputElement | HTMLTextAreaElement,
    error: HTMLElement,
  ): void {
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  }

  private reportActionError(error: unknown): void {
    this.setStatus(
      `Action failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }

  private setStatus(message: string, tone: StatusTone): void {
    this.view.setStatus(message, tone);
  }

  private scheduleUrlUpdate(): void {
    if (this.disposed) return;
    if (this.urlTimer !== null) window.clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => {
      this.urlTimer = null;
      this.writeUrl();
    }, URL_UPDATE_DELAY_MS);
  }

  private buildHash(): string {
    const playback = this.session.snapshot().playback;
    const word = playback
      ? playback.word.slice(playback.index)
      : this.wordPreview?.ok
        ? this.wordPreview.value.moves
        : [];
    const scramble = generateScramble(
      this.puzzle,
      this.view.elements.seedInput.value,
      this.view.elements.scrambleLength.value,
    );
    return encodeSessionHash(this.puzzle, this.session.currentState(), {
      word,
      ...(scramble.ok
        ? { seed: scramble.value.seed, scrambleLength: scramble.value.length }
        : {}),
    });
  }

  private writeUrl(): string {
    const hash = this.buildHash();
    this.lastWrittenHash = hash;
    window.history.replaceState(null, "", hash);
    return new URL(window.location.href).href;
  }

  private flushUrlUpdate(): string {
    if (this.urlTimer !== null) {
      window.clearTimeout(this.urlTimer);
      this.urlTimer = null;
    }
    return this.writeUrl();
  }

  private hydrateDecodedSession(
    decoded: DecodedSession<EdgeState, Move>,
    announce: boolean,
  ): void {
    this.invalidateAnalysis();
    this.playback.stop();
    this.session.replaceRoot(decoded.state);
    this.view.elements.wordInput.value = decoded.wordText;
    this.view.elements.seedInput.value = decoded.seed || "example";
    this.view.elements.scrambleLength.value = String(decoded.scrambleLength);
    this.lastScramble = null;
    if (decoded.word.length > 0) {
      this.playback.start(decoded.word, "shared", "Shared word", false);
    }
    this.updateWordPreview();
    this.render();
    void this.transitionScene(decoded.state, { animate: false, durationMs: 0 });

    if (decoded.warnings.length > 0) {
      this.setStatus(
        decoded.warnings.map((warning) => warning.message).join(" "),
        "warning",
      );
    } else if (announce || decoded.hasSession) {
      this.setStatus(
        decoded.word.length > 0
          ? "Shared word ready at step 0."
          : "Shared state loaded.",
        "success",
      );
    } else {
      this.setStatus("Ready.", "info");
    }
  }

  private readonly onHashChange = (): void => {
    if (window.location.hash === this.lastWrittenHash) return;
    if (!isSessionFragment(window.location.hash)) return;
    const decoded = decodeSessionHash(window.location.hash, this.puzzle);
    this.hydrateDecodedSession(decoded, true);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isInteractiveTarget(event.target)) return;
    const playback = this.session.snapshot().playback;
    if (event.code === "Space" && playback) {
      event.preventDefault();
      this.playback.toggle();
      return;
    }
    if (event.code === "ArrowLeft" && playback && !playback.isPlaying) {
      event.preventDefault();
      void this.playback.stepBackward();
      return;
    }
    if (event.code === "ArrowRight" && playback && !playback.isPlaying) {
      event.preventDefault();
      void this.playback.stepForward();
      return;
    }

    const lower = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (!command && !playback) {
      if (lower === "f" || lower === "s") {
        event.preventDefault();
        const base = lower.toUpperCase();
        this.applyMove(`${base}${event.shiftKey ? "'" : ""}` as Move);
        return;
      }
    }
    if (command && lower === "z" && !event.shiftKey && !playback) {
      event.preventDefault();
      this.undo();
      return;
    }
    if (
      command &&
      (lower === "y" || (lower === "z" && event.shiftKey)) &&
      !playback
    ) {
      event.preventDefault();
      this.redo();
    }
  };
}
