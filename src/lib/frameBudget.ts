export interface FrameBudgetOptions {
  /** Target frame time in milliseconds. The default allows dips down to ~45 fps. */
  readonly budgetMs?: number;
  /** Number of frames averaged before a verdict is made. */
  readonly windowSize?: number;
  /**
   * Frames longer than this are ignored: they come from tab switches, debugger pauses or
   * shader compilation, not from sustained load.
   */
  readonly outlierMs?: number;
}

/**
 * Watches frame times and reports when the device consistently misses its budget, so the
 * scene can trade visual fidelity for smoothness at runtime.
 */
export class FrameBudget {
  readonly #budgetMs: number;
  readonly #windowSize: number;
  readonly #outlierMs: number;
  #total = 0;
  #count = 0;

  constructor({ budgetMs = 22, windowSize = 120, outlierMs = 250 }: FrameBudgetOptions = {}) {
    this.#budgetMs = budgetMs;
    this.#windowSize = windowSize;
    this.#outlierMs = outlierMs;
  }

  /**
   * Records one frame. Returns `true` once per full window whose average frame time
   * exceeded the budget.
   */
  sample(frameMs: number): boolean {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > this.#outlierMs) return false;

    this.#total += frameMs;
    this.#count += 1;
    if (this.#count < this.#windowSize) return false;

    const average = this.#total / this.#count;
    this.reset();
    return average > this.#budgetMs;
  }

  reset(): void {
    this.#total = 0;
    this.#count = 0;
  }
}
