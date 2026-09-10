# Shared classroom capabilities

Classroom tasks use the shared runtime tool catalog and computer controls. The
classroom-specific tool-ID, keyboard, command-type, field-content, text-length,
and demonstration-mode input allowlists have been removed. Shared schemas and
capability availability still apply at the normal runtime boundaries.

Lesson goals, teaching mode, and guidance policy are provided to the model as
context. They are not a second keyboard or text-entry policy. The lesson guard
retains lifecycle authorization, Stop/revocation, fresh observation checks,
serialized dispatch, action budgets, and unknown-outcome tracking. Newly exposed
shared tools also participate in dispatch bookkeeping. Unknown operations are
never replayed. Presentation still requires evidence of the requested material.

No IPC, backend API, SQL migration, or deployment configuration changes are
required. The existing staging teacher/student setup remains compatible.
Regression coverage checks shared catalog parity, shortcuts, desktop typing and
dragging, populated/unknown field content, and text entry outside demonstration
mode. Existing cancellation, stale observation, and unknown-effect tests remain.
CI validates this change. Native window activation remains a separate issue;
removing these restrictions restores recovery options without claiming to fix
Windows foreground activation.
