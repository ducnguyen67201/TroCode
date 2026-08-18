import type { CompanionInteraction } from '../shared/contracts';

type ApprovalInteraction = Extract<
  CompanionInteraction,
  { kind: 'approval' }
>;

interface CursorApprovalChatProps {
  approvalExpired: boolean;
  interaction: ApprovalInteraction;
  isSending: boolean;
  onDecision(decision: 'approve' | 'deny'): void;
}

/**
 * Keeps an exact-action approval beside the cursor companion. The compact
 * summary remains visible while lower-level parameters use inline disclosure,
 * so approving never requires opening the main application window.
 */
export function CursorApprovalChat({
  approvalExpired,
  interaction,
  isSending,
  onDecision,
}: CursorApprovalChatProps) {
  return (
    <div className="cursor-approval-chat">
      <div className="cursor-approval-chat__message">
        <p className="guidance-callout__consequence">
          {interaction.consequence}
        </p>
        <div className="cursor-approval-chat__action">
          <span>{interaction.action.label}</span>
          <p>{interaction.action.description}</p>
          {interaction.action.target ? (
            <p className="cursor-approval-chat__target">
              <strong>Target</strong>
              {interaction.action.target}
            </p>
          ) : null}
        </div>
      </div>

      {approvalExpired ? (
        <p className="guidance-callout__expired">
          This approval expired. Ask TroCode to try again.
        </p>
      ) : (
        <div
          aria-label="Exact approval actions"
          className="guidance-callout__approval-actions"
          role="group"
        >
          <button
            disabled={isSending}
            onClick={() => onDecision('deny')}
            type="button"
          >
            Deny
          </button>
          <button
            className="guidance-callout__approve"
            disabled={isSending}
            onClick={() => onDecision('approve')}
            type="button"
          >
            {isSending ? 'Submitting…' : 'Approve action'}
          </button>
        </div>
      )}

      {interaction.action.details.length > 0 ||
      interaction.action.hasMoreDetails ? (
        <details className="cursor-approval-chat__details">
          <summary>Review exact details</summary>
          {interaction.action.details.length > 0 ? (
            <dl className="guidance-callout__approval-details">
              {interaction.action.details.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {interaction.action.hasMoreDetails ? (
            <p className="cursor-approval-chat__omitted">
              Some low-level parameters were shortened for this cursor card.
            </p>
          ) : null}
        </details>
      ) : null}

      <p className="guidance-callout__hint">
        Voice or typed “yes” cannot approve · <kbd>⌘/Ctrl ⇧ ↵</kbd> approve
      </p>
    </div>
  );
}
