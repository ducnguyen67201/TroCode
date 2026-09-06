import { randomUUID } from 'node:crypto';

import {
  CompanionResponseCardSchema,
  type CompanionResponseCard,
  type TaskSnapshot,
} from '../../shared/contracts';

const MAX_RESPONSE_LENGTH = 8_000;

type ResponseCompletion = Pick<
  TaskSnapshot,
  'messages' | 'phase' | 'taskId'
>;

export type CompanionOverlayMode =
  | 'interaction'
  | 'guidance'
  | 'response'
  | 'pet_nudge'
  | 'activity'
  | 'hidden';

export interface CompanionOverlayCandidates {
  activity?: unknown;
  guidance?: unknown;
  interaction?: unknown;
  petNudge?: unknown;
  response?: CompanionResponseCard | null;
}

interface CompanionResponseControllerOptions {
  cardId?: () => string;
  side?: () => CompanionResponseCard['side'];
}

export function selectCompanionOverlayMode(
  candidates: CompanionOverlayCandidates,
): CompanionOverlayMode {
  if (candidates.interaction) return 'interaction';
  if (candidates.guidance) return 'guidance';
  if (candidates.response) return 'response';
  if (candidates.petNudge) return 'pet_nudge';
  if (candidates.activity) return 'activity';
  return 'hidden';
}

export class CompanionResponseController {
  private readonly createCardId: () => string;

  private readonly responseSide: () => CompanionResponseCard['side'];

  private activeTaskId: string | null = null;

  private currentCard: CompanionResponseCard | null = null;

  private suppressedTaskId: string | null = null;

  constructor(options: CompanionResponseControllerOptions = {}) {
    this.createCardId = options.cardId ?? randomUUID;
    this.responseSide = options.side ?? (() => 'right');
  }

  setCard(card: CompanionResponseCard): void {
    this.currentCard = CompanionResponseCardSchema.parse(card);
    this.activeTaskId = card.taskId;
    this.suppressedTaskId = null;
  }

  get current(): CompanionResponseCard | null {
    return this.currentCard;
  }

  startRun(taskId: string): CompanionResponseCard | null {
    if (taskId === this.activeTaskId && this.suppressedTaskId !== taskId) {
      return this.currentCard;
    }
    this.activeTaskId = taskId;
    this.currentCard = null;
    this.suppressedTaskId = null;
    return this.currentCard;
  }

  appendTextDelta(
    taskId: string,
    textDelta: string,
  ): CompanionResponseCard | null {
    if (
      taskId !== this.activeTaskId ||
      taskId === this.suppressedTaskId ||
      this.currentCard?.phase === 'completed'
    ) {
      return this.currentCard;
    }

    if (!this.currentCard && textDelta.trim().length === 0) {
      return null;
    }

    const existingMessage = this.currentCard?.message ?? '';
    const remaining = Math.max(
      0,
      MAX_RESPONSE_LENGTH - existingMessage.length,
    );
    if (remaining === 0) return this.currentCard;

    this.currentCard = CompanionResponseCardSchema.parse({
      cardId: this.currentCard?.cardId ?? this.createCardId(),
      message: `${existingMessage}${textDelta.slice(0, remaining)}`,
      phase: 'streaming',
      side: this.currentCard?.side ?? this.responseSide(),
      taskId,
    });
    return this.currentCard;
  }

  complete(snapshot: ResponseCompletion): CompanionResponseCard | null {
    if (
      snapshot.taskId !== this.activeTaskId ||
      snapshot.taskId === this.suppressedTaskId ||
      snapshot.phase !== 'completed'
    ) {
      return this.currentCard;
    }

    const answer = latestAssistantAnswer(snapshot.messages)?.trim();
    if (!answer) {
      this.currentCard = null;
      return null;
    }

    this.currentCard = CompanionResponseCardSchema.parse({
      cardId: this.currentCard?.cardId ?? this.createCardId(),
      message: answer.slice(0, MAX_RESPONSE_LENGTH),
      phase: 'completed',
      side: this.currentCard?.side ?? this.responseSide(),
      taskId: snapshot.taskId,
    });
    return this.currentCard;
  }

  failRun(taskId: string): CompanionResponseCard | null {
    return this.endIncompleteRun(taskId);
  }

  cancelRun(taskId: string): CompanionResponseCard | null {
    return this.endIncompleteRun(taskId);
  }

  dismiss(cardId: string, taskId: string): CompanionResponseCard | null {
    if (
      this.currentCard?.cardId !== cardId ||
      this.currentCard.taskId !== taskId
    ) {
      return this.currentCard;
    }
    this.currentCard = null;
    this.suppressedTaskId = taskId;
    return null;
  }

  private endIncompleteRun(taskId: string): CompanionResponseCard | null {
    if (taskId !== this.activeTaskId) return this.currentCard;
    if (
      this.currentCard?.taskId === taskId &&
      this.currentCard.phase === 'streaming'
    ) {
      this.currentCard = null;
    }
    this.activeTaskId = null;
    return this.currentCard;
  }
}

function latestAssistantAnswer(
  messages: ResponseCompletion['messages'],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.kind === 'answer') {
      return message.text;
    }
  }
  return null;
}
