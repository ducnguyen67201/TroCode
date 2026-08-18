class TroCodeVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
    this.pending = new Float32Array(this.frameSamples);
    this.pendingLength = 0;
    this.frameIndex = 0;
  }

  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const copyLength = Math.min(
          channel.length - offset,
          this.frameSamples - this.pendingLength,
        );
        this.pending.set(
          channel.subarray(offset, offset + copyLength),
          this.pendingLength,
        );
        this.pendingLength += copyLength;
        offset += copyLength;
        if (this.pendingLength === this.frameSamples) {
          const frame = this.pending;
          this.port.postMessage(
            { frameIndex: this.frameIndex, sampleRate, samples: frame.buffer },
            [frame.buffer],
          );
          this.frameIndex += 1;
          this.pending = new Float32Array(this.frameSamples);
          this.pendingLength = 0;
        }
      }
    }

    for (const output of outputs) {
      for (const outputChannel of output) outputChannel.fill(0);
    }
    return true;
  }
}

registerProcessor('trocode-voice-capture', TroCodeVoiceCaptureProcessor);
