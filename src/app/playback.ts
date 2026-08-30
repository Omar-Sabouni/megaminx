import type { PlaybackSource, SessionModel } from "./session";

export interface PlaybackTransitionOptions {
  durationMs: number;
  animate: boolean;
}

export interface PlaybackControllerOptions<S> {
  transition: (state: S, options: PlaybackTransitionOptions) => Promise<void>;
  onChange: () => void;
  onComplete: (moveCount: number) => void;
  getSpeed: () => number;
  reducedMotion: () => boolean;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export class PlaybackController<S, M extends string> {
  private token = 0;

  constructor(
    private readonly session: SessionModel<S, M>,
    private readonly options: PlaybackControllerOptions<S>,
  ) {}

  start(
    word: readonly M[],
    source: PlaybackSource,
    label: string,
    autoPlay = false,
  ): boolean {
    this.stop();
    const playback = this.session.startPlayback(word, source, label, autoPlay);
    this.options.onChange();
    if (!playback) return false;
    if (autoPlay) this.runLoop();
    return true;
  }

  stop(): void {
    this.token += 1;
    this.session.stopPlayback();
    this.options.onChange();
  }

  toggle(): void {
    const playback = this.session.snapshot().playback;
    if (!playback) return;
    if (playback.index >= playback.word.length) {
      void this.restart(true);
      return;
    }
    const shouldPlay = !playback.isPlaying;
    this.session.setPlaybackPlaying(shouldPlay);
    this.options.onChange();
    if (shouldPlay) this.runLoop();
    else this.token += 1;
  }

  async stepForward(): Promise<boolean> {
    const playback = this.session.snapshot().playback;
    if (!playback || playback.isPlaying) return false;
    const state = this.session.stepPlaybackForward();
    if (!state) return false;
    this.options.onChange();
    await this.options.transition(state, this.transitionOptions());
    this.options.onChange();
    return true;
  }

  async stepBackward(): Promise<boolean> {
    const playback = this.session.snapshot().playback;
    if (!playback || playback.isPlaying) return false;
    const state = this.session.stepPlaybackBackward();
    if (!state) return false;
    this.options.onChange();
    await this.options.transition(state, this.transitionOptions());
    this.options.onChange();
    return true;
  }

  async seek(index: number): Promise<boolean> {
    const state = this.session.seekPlayback(index);
    if (!state) return false;
    this.options.onChange();
    await this.options.transition(state, this.transitionOptions());
    this.options.onChange();
    return true;
  }

  async restart(resume = false): Promise<boolean> {
    const playback = this.session.snapshot().playback;
    if (!playback) return false;
    this.token += 1;
    this.session.setPlaybackPlaying(false);
    const state = this.session.restartPlayback();
    if (!state) return false;
    this.options.onChange();
    await this.options.transition(state, this.transitionOptions());
    if (resume) {
      this.session.setPlaybackPlaying(true);
      this.options.onChange();
      this.runLoop();
    }
    return true;
  }

  private transitionOptions(): PlaybackTransitionOptions {
    const speed = Math.max(0.25, Math.min(2, this.options.getSpeed()));
    return {
      animate: !this.options.reducedMotion(),
      durationMs: Math.max(70, Math.round(280 / speed)),
    };
  }

  private runLoop(): void {
    const token = this.token + 1;
    this.token = token;
    void (async () => {
      while (this.token === token) {
        const before = this.session.snapshot().playback;
        if (!before || !before.isPlaying || before.index >= before.word.length)
          break;

        const state = this.session.stepPlaybackForward();
        if (!state) break;
        this.options.onChange();
        await this.options.transition(state, this.transitionOptions());
        if (this.token !== token) return;

        const speed = Math.max(0.25, Math.min(2, this.options.getSpeed()));
        if (!this.options.reducedMotion()) await wait(Math.round(90 / speed));
      }

      if (this.token !== token) return;
      const after = this.session.snapshot().playback;
      if (after && after.index >= after.word.length) {
        this.session.setPlaybackPlaying(false);
        this.options.onComplete(after.word.length);
        this.options.onChange();
      }
    })();
  }
}
