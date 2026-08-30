export class ActionQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly onBusyChange: (busy: boolean) => void = () => undefined,
  ) {}

  get busy(): boolean {
    return this.pending > 0;
  }

  enqueue(action: () => Promise<void>): Promise<void> {
    this.pending += 1;
    this.onBusyChange(true);
    const run = this.tail.then(action);
    this.tail = run
      .catch(() => undefined)
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        this.onBusyChange(this.pending > 0);
      });
    return run;
  }
}
