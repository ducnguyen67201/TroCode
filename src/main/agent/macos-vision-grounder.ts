import { spawn } from 'node:child_process';

import { z } from 'zod';

import type {
  DesktopActionDecision,
  DesktopObservation,
} from './execution-contracts';

export const MACOS_VISION_OCR_HELPER_NAME = 'trocode-macos-vision-ocr';

const MAX_HELPER_OUTPUT_BYTES = 2_000_000;
const OCR_TIMEOUT_MS = 5_000;

const RecognizedTextBoxSchema = z.object({
  confidence: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  text: z.string().min(1).max(20_000),
  width: z.number().min(0).max(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const RecognizedTextBoxesSchema = z.array(RecognizedTextBoxSchema).max(10_000);

export type RecognizedTextBox = z.infer<typeof RecognizedTextBoxSchema>;

export interface GroundedPoint {
  matchedText: string;
  point: { x: number; y: number };
  source: 'macos_vision_text';
}

interface MacOSVisionGrounderOptions {
  executablePath: string;
  logger?: Pick<Console, 'warn'>;
  platform?: NodeJS.Platform;
  recognize?: (
    image: Buffer,
    signal?: AbortSignal,
  ) => Promise<RecognizedTextBox[]>;
}

function abortError(): Error {
  const error = new Error('Visual grounding was cancelled.');
  error.name = 'AbortError';
  return error;
}

function questionNumberFromDecision(
  decision: DesktopActionDecision,
): number | null {
  const text = `${decision.target ?? ''}\n${decision.description}`;
  const explicit = text.match(
    /(?:question|item|exercise|câu(?:\s+hỏi)?)\s*#?\s*(\d{1,3})/iu,
  );
  if (explicit?.[1]) return Number(explicit[1]);

  return decision.guidanceSequence?.index ?? null;
}

function recognizedQuestionNumber(text: string): number | null {
  const match = text.match(
    /^\s*(\d{1,3})(?:\s*[.)．:,;]|(?=\s+\p{L}))/u,
  );
  return match?.[1] ? Number(match[1]) : null;
}

function clampPixel(value: number, extent: number): number {
  return Math.min(extent - 1, Math.max(0, Math.round(value)));
}

export function parseMacOSVisionOutput(output: string): RecognizedTextBox[] {
  return RecognizedTextBoxesSchema.parse(JSON.parse(output));
}

export function groundNumberedGuidancePoint(
  decision: DesktopActionDecision,
  observation: DesktopObservation,
  boxes: RecognizedTextBox[],
): GroundedPoint | null {
  if (decision.command.kind !== 'point' || !observation.coordinateSpace) {
    return null;
  }

  const questionNumber = questionNumberFromDecision(decision);
  if (!questionNumber) return null;

  const candidates = boxes
    .filter((box) => recognizedQuestionNumber(box.text) === questionNumber)
    .sort((left, right) => {
      const confidenceDifference = right.confidence - left.confidence;
      if (Math.abs(confidenceDifference) > 0.05) return confidenceDifference;
      return right.text.length - left.text.length;
    });
  const match = candidates[0];
  if (!match) return null;

  const { screenshotHeight, screenshotWidth } = observation.coordinateSpace;
  const lineHeight = match.height * screenshotHeight;
  const horizontalInset = Math.max(12, Math.min(96, lineHeight * 2));

  return {
    matchedText: match.text,
    point: {
      x: clampPixel(
        (match.x + match.width) * screenshotWidth + horizontalInset,
        screenshotWidth,
      ),
      y: clampPixel(
        (1 - (match.y + match.height / 2)) * screenshotHeight,
        screenshotHeight,
      ),
    },
    source: 'macos_vision_text',
  };
}

export class MacOSVisionGrounder {
  private readonly executablePath: string;

  private readonly logger: Pick<Console, 'warn'>;

  private readonly platform: NodeJS.Platform;

  private readonly recognize: (
    image: Buffer,
    signal?: AbortSignal,
  ) => Promise<RecognizedTextBox[]>;

  constructor({
    executablePath,
    logger = console,
    platform = process.platform,
    recognize,
  }: MacOSVisionGrounderOptions) {
    this.executablePath = executablePath;
    this.logger = logger;
    this.platform = platform;
    this.recognize =
      recognize ??
      ((image, signal) => this.recognizeWithHelper(image, signal));
  }

  async ground(
    decision: DesktopActionDecision,
    observation: DesktopObservation,
    signal?: AbortSignal,
  ): Promise<GroundedPoint | null> {
    if (
      this.platform !== 'darwin' ||
      decision.command.kind !== 'point' ||
      !observation.screenshot ||
      !observation.coordinateSpace
    ) {
      return null;
    }

    try {
      const boxes = await this.recognize(
        Buffer.from(observation.screenshot.dataBase64, 'base64'),
        signal,
      );
      const grounded = groundNumberedGuidancePoint(
        decision,
        observation,
        boxes,
      );
      if (!grounded) {
        this.logger.warn('[grounding] numbered target was not matched.', {
          requestedQuestion: questionNumberFromDecision(decision),
          detectedQuestions: [
            ...new Set(
              boxes
                .map((box) => recognizedQuestionNumber(box.text))
                .filter((value): value is number => value !== null),
            ),
          ].slice(0, 30),
        });
      }
      return grounded;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn('[grounding] macOS Vision OCR unavailable.', {
        error:
          error instanceof Error
            ? { message: error.message, name: error.name }
            : { message: String(error) },
      });
      return null;
    }
  }

  private recognizeWithHelper(
    image: Buffer,
    signal?: AbortSignal,
  ): Promise<RecognizedTextBox[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executablePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let settled = false;
      let stderr = '';
      let stdout = '';

      const settle = (
        error?: Error,
        boxes?: RecognizedTextBox[],
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', handleAbort);
        if (error) reject(error);
        else resolve(boxes ?? []);
      };
      const handleAbort = (): void => {
        child.kill();
        settle(abortError());
      };
      const timer = setTimeout(() => {
        child.kill();
        settle(new Error('macOS Vision OCR timed out.'));
      }, OCR_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > MAX_HELPER_OUTPUT_BYTES) {
          child.kill();
          settle(new Error('macOS Vision OCR output exceeded its limit.'));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-2_000);
      });
      child.once('error', (error) => settle(error));
      child.once('exit', (code, exitSignal) => {
        if (settled) return;
        if (code !== 0) {
          settle(
            new Error(
              stderr.trim() ||
                `macOS Vision OCR exited with ${code ?? exitSignal ?? 'unknown status'}.`,
            ),
          );
          return;
        }
        try {
          settle(undefined, parseMacOSVisionOutput(stdout));
        } catch (error) {
          settle(
            error instanceof Error
              ? error
              : new Error('macOS Vision OCR returned invalid output.'),
          );
        }
      });

      signal?.addEventListener('abort', handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      child.stdin.end(image);
    });
  }
}
