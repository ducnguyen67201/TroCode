import type {
  AppLanguage,
  PendingInteraction,
} from '../../../shared/contracts';
import { translate } from '../../app-language';

export function PendingInteractionCard({
  appLanguage,
  interaction,
  isSending,
  onAnswerChoice,
}: {
  appLanguage: AppLanguage;
  interaction: PendingInteraction;
  isSending: boolean;
  onAnswerChoice: (answer: string, choiceId: string) => void;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section
      aria-live="polite"
      aria-labelledby="interaction-heading"
      className="interaction-card interaction-card--clarification"
    >
      <p className="eyebrow">{t('Tro needs your input')}</p>
      <h2 id="interaction-heading">{interaction.prompt}</h2>
      {interaction.choices && (
        <div className="interaction-choices">
          {interaction.choices.map((choice) => (
            <button
              disabled={isSending}
              key={choice.id}
              onClick={() => onAnswerChoice(choice.label, choice.id)}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <p>
        {t(
          'Answer below by voice or text. Your response will continue this task.',
        )}
      </p>
    </section>
  );
}
