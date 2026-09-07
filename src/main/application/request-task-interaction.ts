import { TaskUpdateSchema } from '../../shared/contracts';
import type { TaskRuntime } from '../agent/task-runtime';

export async function requestTaskInteraction(
  taskRuntime: TaskRuntime,
  taskId: string,
  input: { choices?: string[]; prompt: string },
): Promise<string> {
  const waiting = taskRuntime.requestInput({
    choices: input.choices?.map((label, index) => ({
      id: `choice-${index + 1}`,
      label,
    })),
    prompt: input.prompt,
    taskId,
  });
  const interactionId = waiting.pendingInteraction?.id;
  if (!interactionId) throw new Error('Could not create the clarification request.');

  return new Promise<string>((resolve, reject) => {
    const finish = (answer?: string, error?: Error): void => {
      clearTimeout(timer);
      taskRuntime.off('task-update', onUpdate);
      if (error) reject(error);
      else if (answer) resolve(answer);
      else reject(new Error('The clarification ended without an answer.'));
    };
    const onUpdate = (value: unknown): void => {
      const parsed = TaskUpdateSchema.safeParse(value);
      if (!parsed.success || parsed.data.snapshot.taskId !== taskId) return;
      const snapshot = parsed.data.snapshot;
      if (snapshot.pendingInteraction?.id === interactionId) return;
      const answer = [...snapshot.messages]
        .reverse()
        .find((message) => message.role === 'user' && message.kind === 'answer');
      finish(answer?.text);
    };
    const timer = setTimeout(() => finish(undefined, new Error('The clarification request expired.')), 30 * 60_000);
    taskRuntime.on('task-update', onUpdate);
  });
}
