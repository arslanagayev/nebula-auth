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
  /** Consecutive over-budget windows required before degrading, so one busy moment is ignored. */
  readonly patience?: number;
  /** Relative frame-time improvement a degrade step must achieve to be kept. */
  readonly minImprovement?: number;
}

/**
 * - `degrade`: frames consistently miss the budget; give up some fidelity.
 * - `restore`: the last degrade step did not make frames faster, so the GPU was not the
 *   bottleneck (typically a display or battery saver capping rAF at 30 Hz); undo it.
 */
export type BudgetVerdict = 'degrade' | 'restore' | null;

/**
 * Watches frame times and reports when the device consistently misses its budget, so the
 * scene can trade visual fidelity for smoothness at runtime.
 *
 * Frame times alone cannot tell an overloaded GPU from a display capped at 30 Hz (Low Power
 * Mode, Chrome's Energy Saver, throttled iframes): both produce steady ~33 ms frames. So
 * every degrade step is an experiment. If the next window is not measurably faster, the
 * monitor asks for the step to be undone and stops adapting, instead of stripping bloom and
 * resolution from a device that was never struggling.
 */
export class FrameBudget {
  readonly #budgetMs: number;
  readonly #windowSize: number;
  readonly #outlierMs: number;
  readonly #patience: number;
  readonly #minImprovement: number;
  #total = 0;
  #count = 0;
  #strikes = 0;
  /** Average frame time of the window that triggered the last degrade, while it is on trial. */
  #onTrial: number | null = null;
  #settled = false;

  constructor({
    budgetMs = 22,
    windowSize = 120,
    outlierMs = 250,
    patience = 2,
    minImprovement = 0.1,
  }: FrameBudgetOptions = {}) {
    this.#budgetMs = budgetMs;
    this.#windowSize = windowSize;
    this.#outlierMs = outlierMs;
    this.#patience = patience;
    this.#minImprovement = minImprovement;
  }

  /** Records one frame. Returns a verdict at most once per full window. */
  sample(frameMs: number): BudgetVerdict {
    if (this.#settled) return null;
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > this.#outlierMs) return null;

    this.#total += frameMs;
    this.#count += 1;
    if (this.#count < this.#windowSize) return null;

    const average = this.#total / this.#count;
    this.reset();

    if (this.#onTrial !== null) {
      const before = this.#onTrial;
      this.#onTrial = null;
      if (average > before * (1 - this.#minImprovement)) {
        this.#settled = true;
        return 'restore';
      }
    }

    if (average <= this.#budgetMs) {
      this.#strikes = 0;
      return null;
    }
    this.#strikes += 1;
    if (this.#strikes < this.#patience) return null;

    this.#strikes = 0;
    this.#onTrial = average;
    return 'degrade';
  }

  /** Starts a fresh measurement window, e.g. after the tab was hidden. */
  reset(): void {
    this.#total = 0;
    this.#count = 0;
  }
}
