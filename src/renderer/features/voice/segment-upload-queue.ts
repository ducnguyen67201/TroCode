import { DEFAULT_VOICE_SEGMENTATION_POLICY } from './segmentation-policy';

export class SegmentUploadQueue<Input, Output> {
  readonly #worker: (input: Input) => Promise<Output>;
  readonly #concurrency: number;
  readonly #pending: Array<QueueEntry<Input, Output>> = [];
  #active = 0;

  constructor(
    worker: (input: Input) => Promise<Output>,
    concurrency = DEFAULT_VOICE_SEGMENTATION_POLICY.uploadConcurrency,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Upload concurrency must be a positive integer.');
    }
    this.#worker = worker;
    this.#concurrency = concurrency;
  }

  get activeCount(): number {
    return this.#active;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  enqueue(input: Input): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      this.#pending.push({ input, reject, resolve });
      this.#drain();
    });
  }

  cancelPending(
    error: Error = new Error('Segment upload was cancelled.'),
  ): void {
    for (const entry of this.#pending.splice(0)) entry.reject(error);
  }

  #drain(): void {
    while (this.#active < this.#concurrency && this.#pending.length > 0) {
      const entry = this.#pending.shift();
      if (!entry) return;
      this.#active += 1;
      void this.#worker(entry.input)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}

interface QueueEntry<Input, Output> {
  input: Input;
  reject: (error: unknown) => void;
  resolve: (output: Output) => void;
}
