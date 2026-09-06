import type { AppLanguage, TaskSnapshot } from '../../../shared/contracts';
import { translate } from '../../app-language';

export function Conversation({
  appLanguage,
  snapshot,
}: {
  appLanguage: AppLanguage;
  snapshot: TaskSnapshot;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section
      className="conversation-card"
      aria-labelledby="conversation-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Same task')}</p>
          <h2 id="conversation-heading">{t('Conversation')}</h2>
        </div>
        <span className="event-count">{snapshot.messages.length}</span>
      </div>
      <ol aria-live="polite" className="message-list">
        {snapshot.messages.map((message) => (
          <li
            className={`message message--${message.role}`}
            key={message.messageId}
          >
            <span>{message.role === 'user' ? t('You') : 'Tro'}</span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
