import type { PuzzleDefinition } from "../puzzles/types";

export interface HistorySnapshot<S, M extends string> {
  states: readonly S[];
  moves: readonly M[];
  cursor: number;
}

export type PlaybackSource = "solution" | "word" | "scramble" | "shared";

export interface PlaybackSnapshot<S, M extends string> {
  source: PlaybackSource;
  label: string;
  anchorState: S;
  anchorKey: string;
  anchorCursor: number;
  word: readonly M[];
  index: number;
  isPlaying: boolean;
}

export interface SessionSnapshot<S, M extends string> {
  currentState: S;
  currentKey: string;
  history: HistorySnapshot<S, M>;
  playback: PlaybackSnapshot<S, M> | null;
}

/**
 * Pure session state. Rendering and timers intentionally live outside this model so
 * worker responses, animation failures, and browser events cannot become the
 * authoritative puzzle state.
 */
export class SessionModel<S, M extends string> {
  private states: S[];
  private moves: M[] = [];
  private cursor = 0;
  private activePlayback: PlaybackSnapshot<S, M> | null = null;

  constructor(
    private readonly puzzle: PuzzleDefinition<S, M>,
    initialState: S = puzzle.solvedState,
  ) {
    this.states = [this.puzzle.cloneState(initialState)];
  }

  snapshot(): SessionSnapshot<S, M> {
    const currentState = this.currentState();
    return {
      currentState,
      currentKey: this.puzzle.serialize(currentState),
      history: {
        states: this.states.map((state) => this.puzzle.cloneState(state)),
        moves: [...this.moves],
        cursor: this.cursor,
      },
      playback: this.activePlayback
        ? {
            ...this.activePlayback,
            anchorState: this.puzzle.cloneState(
              this.activePlayback.anchorState,
            ),
            word: [...this.activePlayback.word],
          }
        : null,
    };
  }

  currentState(): S {
    return this.puzzle.cloneState(this.states[this.cursor]);
  }

  currentKey(): string {
    return this.puzzle.serialize(this.states[this.cursor]);
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.states.length - 1;
  }

  replaceRoot(state: S): S {
    this.states = [this.puzzle.cloneState(state)];
    this.moves = [];
    this.cursor = 0;
    this.activePlayback = null;
    return this.currentState();
  }

  commitMove(move: M): S {
    if (this.cursor < this.states.length - 1) {
      this.states = this.states.slice(0, this.cursor + 1);
      this.moves = this.moves.slice(0, this.cursor);
    }
    const next = this.puzzle.applyMove(this.states[this.cursor], move);
    this.states.push(this.puzzle.cloneState(next));
    this.moves.push(move);
    this.cursor += 1;
    return this.currentState();
  }

  commitWord(word: readonly M[]): S {
    for (const move of word) {
      this.commitMove(move);
    }
    return this.currentState();
  }

  undo(): S | null {
    if (!this.canUndo()) return null;
    this.activePlayback = null;
    this.cursor -= 1;
    return this.currentState();
  }

  redo(): S | null {
    if (!this.canRedo()) return null;
    this.activePlayback = null;
    this.cursor += 1;
    return this.currentState();
  }

  startPlayback(
    word: readonly M[],
    source: PlaybackSource,
    label: string,
    isPlaying = false,
  ): PlaybackSnapshot<S, M> | null {
    if (word.length === 0) {
      this.activePlayback = null;
      return null;
    }
    const anchorState = this.currentState();
    this.activePlayback = {
      source,
      label,
      anchorState,
      anchorKey: this.puzzle.serialize(anchorState),
      anchorCursor: this.cursor,
      word: [...word],
      index: 0,
      isPlaying,
    };
    return this.snapshot().playback;
  }

  setPlaybackPlaying(isPlaying: boolean): void {
    if (this.activePlayback)
      this.activePlayback = { ...this.activePlayback, isPlaying };
  }

  stepPlaybackForward(): S | null {
    const playback = this.activePlayback;
    if (!playback || playback.index >= playback.word.length) return null;

    const move = playback.word[playback.index];
    const knownMove = this.moves[this.cursor];
    if (this.cursor < this.states.length - 1 && knownMove === move) {
      this.cursor += 1;
    } else {
      this.commitMove(move);
    }
    this.activePlayback = { ...playback, index: playback.index + 1 };
    return this.currentState();
  }

  stepPlaybackBackward(): S | null {
    const playback = this.activePlayback;
    if (
      !playback ||
      playback.index === 0 ||
      this.cursor <= playback.anchorCursor
    )
      return null;
    this.cursor -= 1;
    this.activePlayback = {
      ...playback,
      index: playback.index - 1,
      isPlaying: false,
    };
    return this.currentState();
  }

  seekPlayback(index: number): S | null {
    const playback = this.activePlayback;
    if (!playback || playback.isPlaying) return null;
    const target = Math.max(
      0,
      Math.min(playback.word.length, Math.trunc(index)),
    );

    this.cursor = playback.anchorCursor;
    this.states = this.states.slice(0, playback.anchorCursor + 1);
    this.moves = this.moves.slice(0, playback.anchorCursor);
    this.activePlayback = { ...playback, index: 0, isPlaying: false };
    for (let step = 0; step < target; step += 1) {
      this.commitMove(playback.word[step]);
      if (this.activePlayback) {
        this.activePlayback = {
          ...this.activePlayback,
          index: step + 1,
          isPlaying: false,
        };
      }
    }
    return this.currentState();
  }

  restartPlayback(): S | null {
    return this.seekPlayback(0);
  }

  stopPlayback(): void {
    this.activePlayback = null;
  }
}
