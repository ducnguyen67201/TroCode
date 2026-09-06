# Implementation report: frontend refactoring

Date: 2026-09-06. Branch: `codex/frontend-refactor`. Baseline: `cd9cdc2`.

## Result and scope

Implemented the frontend structural work from batches 1–8. All 13 oversized
frontend production files are below 500 physical lines. The largest frontend
module is now 494 lines. App is 472 lines, down from 3,603, and composes feature
resource owners, the sidebar, workspace, entry gates and settings.

This is a local implementation result, not completion of the whole program.
Hosted platform CI, visual acceptance and live teacher/student acceptance remain
pending. The provisional native/backend batch 9 has not been implemented.
The original plan stays open and is not archived as complete.

## Assessment versus plan

| Measure | Plan/baseline | Implemented result |
| --- | --- | --- |
| Frontend production files | 83 | 204 |
| Frontend physical lines | 36,138 | 39,260 |
| Files above 500 lines | 13 | 0 |
| Files above 1,000 lines | 5 | 0 |
| App | 3,603; ideally below 300 | 472; below hard ceiling, explicit composition retained |
| Maximum frontend module | 12,995 | 494 |
| Dead-code/dependency deletion | Verify candidates first | None; uncertain candidate retained |

File count/line growth reflects explicit interfaces, imports and formatting after
extraction. These metrics measure module size, not a reduction in total behavior
or proof of readability. The per-file rationale is recorded in
`docs/frontend-source-inventory.md`.

## Implementation milestones

| Batch | Local code status | Evidence or remaining acceptance |
| --- | --- | --- |
| 1. Baseline and guardrails | Implemented | Reproducible inventory, size ratchet, import restrictions/cycle rule, real React harness, measured coverage floors; live screenshots pending |
| 2. Styles | Implemented | 30 desktop and four admin groups; exact expanded CSS hashes preserve order/content; visual acceptance pending |
| 3. Translations/settings/companion | Implemented | Domain dictionaries and 1,008-key preservation; six mounted settings sections; preview/form/gallery split |
| 4. App presentation | Implemented | Sidebar, workspace, settings composition, task views and context panel |
| 5. Resource ownership | Implemented | Task session/commands, settings resources, membership/organization, teacher/class selection, voice routing |
| 6. Voice internals | Implemented | Shortcut/completion hooks; capture owner preserved; encoding, policy, queue and assembler extracted |
| 7. Feature pages | Implemented | Facilitator controls/dashboard/composer, space people, attempt controls, organization profile/banner/members |
| 8. Admin and remaining audit | Implemented | Users query/table; audit disposition for all 83 originals; retained cohesive modules |
| 9. Native/backend | Pending | Provisional boundaries in plan; 26 existing size exceptions cannot grow |

## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, zero errors |
| `npm run lint` | Pass, zero errors or warnings; includes new runtime cycle/import rules |
| `npm run test:frontend` | Pass, 60 files and 288 tests; coverage floors pass |
| `npm run check:source-size` | Pass, five guard tests and 394 production-source inventory entries |
| `npm run check:renderer` | Pass, asset-path regression and both renderer bundles |
| `npm run admin:build` | Pass; tracked admin bundle regenerated from final frontend source |
| `git diff --check` | Pass |
| Hosted full source/native/platform CI | Pending; no authorized push or PR |
| Desktop/admin visual and live classroom acceptance | Pending; no live account/provider interactions performed |

The final checks were consolidated after implementation as requested by
`prp-implement`. Failed checks were corrected and rerun. Import/composition fixes
invalidated the earlier bundle results, so those builds were repeated after the
fixes. Additional command/routing regressions and coverage floors were validated
once complete. Full native/local test suites were not substituted for hosted CI.

Initial measured coverage floors are intentionally scoped to three migrated
lifecycle owners. They are enforced by frontend and full TypeScript coverage runs:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `use-task-commands.ts` | 59% | 53% | 76% | 60% |
| `use-voice-turn-routing.ts` | 74% | 67% | 71% | 74% |
| Admin `useUsers.ts` | 85% | 73% | 71% | 92% |

These are measured initial floors, not a claim of comprehensive frontend
coverage. The focused run also lists unexecuted main-agent modules because the
existing coverage configuration still includes them. Its aggregate percentage
must not be treated as repository-wide coverage.

## Corrections found during validation

- Restored admin row-action callbacks at the new table boundary and added a UI
  regression that exercises each action and disabled states.
- Corrected inferred prop types for task snapshots, computer status, companion
  status and activity intents; retained their original non-null contracts.
- Restored browser environment pragmas for new React lifecycle tests.
- Corrected type-only imports and included stable setter/ref dependencies in
  extracted hooks. Task commands now depend on the workspace selection object
  consistently with React Compiler's memoization analysis.
- Installed the existing Agents SDK lockfile dependencies locally so the root
  typecheck could resolve imported service types. No manifest dependency changes.
- Corrected a test expectation: task-mode voice requests retain required screen
  context. Production behavior was preserved.

## Regression coverage added

| File | Tests | Purpose |
| --- | ---: | --- |
| `apps/admin/src/components/UsersTable.test.tsx` | 1 | Row callback wiring and pending mutation controls |
| `apps/admin/src/hooks/useUsers.test.tsx` | 2 | Latest request wins; authorization versus ordinary failures |
| `scripts/source-size.test.mts` | 5 | Physical counts, exclusions, rename/growth/stale-baseline safeguards |
| `src/renderer/features/account/use-organization-members.test.tsx` | 1 | Stale roster after organizer access changes |
| `src/renderer/features/tasks/task-view.test.ts` | 3 | Empty, clarification and active/terminal presentation |
| `src/renderer/features/tasks/use-task-commands.test.tsx` | 5 | Overlapping sends, steering, auto-start dedup, stale cancellation, Escape ownership |
| `src/renderer/features/tasks/use-task-session.test.tsx` | 2 | StrictMode subscriptions, history/live snapshot/event reconciliation |
| `src/renderer/features/voice/use-voice-turn-routing.test.tsx` | 5 | Draft recovery, uncertain delivery, frozen destination and turn cleanup |
| `src/renderer/features/voice/voice-lifecycle.test.tsx` | 2 | Real React idle/remount and delayed preflight after unmount |
| `src/renderer/i18n/translations-preservation.test.ts` | 1 | Original merged translation content and precedence |
| `src/test-support/styles-preservation.test.ts` | 2 | Original desktop/admin CSS expanded byte identity |

Existing semantic, settings focus/draft, App mounting, voice segmentation and
shortcut tests remain intact. CSS-reading tests follow ordered imports while
preserving their original assertions. New tests assert behavior and lifecycle
ownership rather than reproducing trivial implementation functions.

## Deviations and limits

- The frontend work is one local change set rather than multiple sequential PRs.
  No external revisions were created. Review by the ownership batches above.
- The App soft target of 300 lines was not forced: 472 lines retains explicit,
  typed connections instead of a large opaque controller or compressed source.
- Styles retain ordered contiguous groups in a central styles folder. Domain
  regrouping and duplicate-selector removal await visual acceptance.
- `companion-state.ts` remains an unconfirmed dead-code candidate. No deletion
  was made without an applicable safety baseline. Public contracts/IPC payloads
  and SQL migrations are untouched.
- Existing internal compatibility type exports and the segmenter API remain
  where consumers depend on them. Unneeded voice helper forwarding exports were
  removed after their consumers moved to the feature modules.
- The plan is not archived: external acceptance and native/backend work remain.

## Files changed

141 new files and 22 modified tracked files at report generation.

| Path | Action | Current physical lines |
| --- | --- | ---: |
| `.eslintrc.json` | Updated | 256 |
| `.github/workflows/ci.yml` | Updated | 194 |
| `apps/admin/src/components/UsersTable.test.tsx` | Created | 85 |
| `apps/admin/src/components/UsersTable.tsx` | Created | 161 |
| `apps/admin/src/hooks/useUsers.test.tsx` | Created | 96 |
| `apps/admin/src/hooks/useUsers.ts` | Created | 90 |
| `apps/admin/src/lib/role-save-state.ts` | Created | 6 |
| `apps/admin/src/lib/user-pagination.ts` | Created | 1 |
| `apps/admin/src/pages/UsersPage.tsx` | Updated | 327 |
| `apps/admin/src/styles.css` | Updated | 5 |
| `apps/admin/src/styles/01-root.css` | Created | 447 |
| `apps/admin/src/styles/02-usage-chart-legend-i.css` | Created | 448 |
| `apps/admin/src/styles/03-tbody-trlast-child-td.css` | Created | 449 |
| `apps/admin/src/styles/04-code-users-dialog.css` | Created | 430 |
| `docs/frontend-architecture.md` | Created | 67 |
| `docs/frontend-refactoring-plan.md` | Created | 349 |
| `docs/frontend-source-inventory.md` | Created | 245 |
| `package.json` | Updated | 135 |
| `scripts/source-size-baseline.json` | Created | 28 |
| `scripts/source-size.mts` | Created | 139 |
| `scripts/source-size.test.mts` | Created | 75 |
| `services/api/admin-dist/assets/admin.js` | Updated | 73 |
| `src/index.css` | Updated | 31 |
| `src/renderer/App.tsx` | Updated | 472 |
| `src/renderer/AttemptLaunchPage.tsx` | Updated | 486 |
| `src/renderer/CompanionCustomizationCard.tsx` | Updated | 355 |
| `src/renderer/CursorBuddy.test.ts` | Updated | 187 |
| `src/renderer/FacilitatorRunPage.tsx` | Updated | 382 |
| `src/renderer/OrganizationPage.tsx` | Updated | 409 |
| `src/renderer/SettingsPage.tsx` | Updated | 286 |
| `src/renderer/SpaceDetailPage.tsx` | Updated | 356 |
| `src/renderer/VoiceModeControl.test.tsx` | Updated | 94 |
| `src/renderer/app-language.ts` | Updated | 43 |
| `src/renderer/app/AppSettings.tsx` | Created | 101 |
| `src/renderer/app/AppSidebar.tsx` | Created | 319 |
| `src/renderer/app/AppWorkspace.tsx` | Created | 292 |
| `src/renderer/app/NavigationIcon.tsx` | Created | 73 |
| `src/renderer/features/account/OrganizationBanner.tsx` | Created | 95 |
| `src/renderer/features/account/OrganizationMembers.tsx` | Created | 131 |
| `src/renderer/features/account/banner-image.ts` | Created | 19 |
| `src/renderer/features/account/member-pagination.ts` | Created | 1 |
| `src/renderer/features/account/organization-presentation.ts` | Created | 13 |
| `src/renderer/features/account/use-membership-activation.ts` | Created | 83 |
| `src/renderer/features/account/use-membership-status.ts` | Created | 77 |
| `src/renderer/features/account/use-organization-banner.ts` | Created | 138 |
| `src/renderer/features/account/use-organization-members.test.tsx` | Created | 73 |
| `src/renderer/features/account/use-organization-members.ts` | Created | 204 |
| `src/renderer/features/account/use-organization-profile.ts` | Created | 112 |
| `src/renderer/features/account/use-organization.ts` | Created | 124 |
| `src/renderer/features/classroom/AttemptControls.tsx` | Created | 213 |
| `src/renderer/features/classroom/ClassDashboard.tsx` | Created | 249 |
| `src/renderer/features/classroom/DirectiveComposer.tsx` | Created | 267 |
| `src/renderer/features/classroom/RunControls.tsx` | Created | 146 |
| `src/renderer/features/classroom/participant-status.ts` | Created | 12 |
| `src/renderer/features/classroom/use-class-spaces.ts` | Created | 165 |
| `src/renderer/features/classroom/use-teacher-selection.ts` | Created | 134 |
| `src/renderer/features/companion/CompanionGenerator.tsx` | Created | 263 |
| `src/renderer/features/companion/CompanionImagePreview.tsx` | Created | 99 |
| `src/renderer/features/companion/CompanionLibrary.tsx` | Created | 123 |
| `src/renderer/features/companion/customization-types.ts` | Created | 6 |
| `src/renderer/features/companion/image-selection.ts` | Created | 27 |
| `src/renderer/features/companion/use-companion-customization.ts` | Created | 178 |
| `src/renderer/features/knowledge/SpacePeoplePanel.tsx` | Created | 393 |
| `src/renderer/features/settings/AboutSettingsSection.tsx` | Created | 90 |
| `src/renderer/features/settings/AccountSettingsSection.tsx` | Created | 202 |
| `src/renderer/features/settings/CompanionSettingsSection.tsx` | Created | 91 |
| `src/renderer/features/settings/ConnectedApplicationsCard.tsx` | Created | 201 |
| `src/renderer/features/settings/ConnectionsSettingsSection.tsx` | Created | 22 |
| `src/renderer/features/settings/GeneralSettingsSection.tsx` | Created | 71 |
| `src/renderer/features/settings/VoiceSettingsSection.tsx` | Created | 121 |
| `src/renderer/features/settings/app-update-presentation.ts` | Created | 31 |
| `src/renderer/features/settings/settings-navigation.tsx` | Created | 103 |
| `src/renderer/features/settings/settings-types.ts` | Created | 49 |
| `src/renderer/features/settings/use-app-preferences.ts` | Created | 142 |
| `src/renderer/features/settings/use-app-updates.ts` | Created | 74 |
| `src/renderer/features/settings/use-system-permissions.ts` | Created | 214 |
| `src/renderer/features/tasks/ActivityList.tsx` | Created | 36 |
| `src/renderer/features/tasks/ComputerConnection.tsx` | Created | 53 |
| `src/renderer/features/tasks/Conversation.tsx` | Created | 37 |
| `src/renderer/features/tasks/LiveTaskRail.tsx` | Created | 203 |
| `src/renderer/features/tasks/PendingInteractionCard.tsx` | Created | 48 |
| `src/renderer/features/tasks/TaskContextPanel.tsx` | Created | 139 |
| `src/renderer/features/tasks/TaskWorkspace.tsx` | Created | 389 |
| `src/renderer/features/tasks/TerminalOutcome.tsx` | Created | 54 |
| `src/renderer/features/tasks/example-tasks.ts` | Created | 6 |
| `src/renderer/features/tasks/task-presentation.ts` | Created | 43 |
| `src/renderer/features/tasks/task-session-projection.ts` | Created | 42 |
| `src/renderer/features/tasks/task-view.test.ts` | Created | 52 |
| `src/renderer/features/tasks/task-view.ts` | Created | 86 |
| `src/renderer/features/tasks/use-task-commands.test.tsx` | Created | 184 |
| `src/renderer/features/tasks/use-task-commands.ts` | Created | 449 |
| `src/renderer/features/tasks/use-task-session.test.tsx` | Created | 132 |
| `src/renderer/features/tasks/use-task-session.ts` | Created | 186 |
| `src/renderer/features/tasks/use-transient-task-error.ts` | Created | 37 |
| `src/renderer/features/tasks/use-workspace-selection.ts` | Created | 77 |
| `src/renderer/features/voice/audio-level.ts` | Created | 6 |
| `src/renderer/features/voice/pcm-encoding.ts` | Created | 99 |
| `src/renderer/features/voice/segment-upload-queue.ts` | Created | 60 |
| `src/renderer/features/voice/segmentation-policy.ts` | Created | 44 |
| `src/renderer/features/voice/transcript-assembler.ts` | Created | 98 |
| `src/renderer/features/voice/use-voice-attempt-start.ts` | Created | 221 |
| `src/renderer/features/voice/use-voice-availability.ts` | Created | 30 |
| `src/renderer/features/voice/use-voice-feedback.ts` | Created | 92 |
| `src/renderer/features/voice/use-voice-mode-selection.ts` | Created | 145 |
| `src/renderer/features/voice/use-voice-shortcuts.ts` | Created | 152 |
| `src/renderer/features/voice/use-voice-turn-completion.ts` | Created | 187 |
| `src/renderer/features/voice/use-voice-turn-routing.test.tsx` | Created | 174 |
| `src/renderer/features/voice/use-voice-turn-routing.ts` | Created | 446 |
| `src/renderer/features/voice/voice-diagnostics.ts` | Created | 52 |
| `src/renderer/features/voice/voice-input-policy.ts` | Created | 78 |
| `src/renderer/features/voice/voice-input-types.ts` | Created | 106 |
| `src/renderer/features/voice/voice-lifecycle.test.tsx` | Created | 114 |
| `src/renderer/guidance-target-marker.test.ts` | Updated | 34 |
| `src/renderer/i18n/translations-preservation.test.ts` | Created | 26 |
| `src/renderer/i18n/vi/account.ts` | Created | 116 |
| `src/renderer/i18n/vi/classroom-1.ts` | Created | 352 |
| `src/renderer/i18n/vi/classroom-2.ts` | Created | 24 |
| `src/renderer/i18n/vi/common-1.ts` | Created | 351 |
| `src/renderer/i18n/vi/common-2.ts` | Created | 71 |
| `src/renderer/i18n/vi/companion.ts` | Created | 98 |
| `src/renderer/i18n/vi/messages.ts` | Created | 24 |
| `src/renderer/i18n/vi/settings.ts` | Created | 71 |
| `src/renderer/i18n/vi/tasks.ts` | Created | 187 |
| `src/renderer/runtime-status.ts` | Created | 17 |
| `src/renderer/styles/01-root.css` | Created | 444 |
| `src/renderer/styles/02-permission-list-li.css` | Created | 446 |
| `src/renderer/styles/03-cursor-buddyimage.css` | Created | 450 |
| `src/renderer/styles/04-activity-form-widesource-picker.css` | Created | 446 |
| `src/renderer/styles/05-guidance-callout--rightbeforeguidance-callout--leftbefo.css` | Created | 446 |
| `src/renderer/styles/06-guidance-calloutanswer-input.css` | Created | 441 |
| `src/renderer/styles/07-keyframes.css` | Created | 447 |
| `src/renderer/styles/08-sidebar-class-workspacemenu-buttonhoversidebar-class-wo.css` | Created | 445 |
| `src/renderer/styles/09-sidebar-accountsign-outhovernotdisabled.css` | Created | 449 |
| `src/renderer/styles/10-voice-mode-controltalkvoice-mode-controlswitch.css` | Created | 448 |
| `src/renderer/styles/11-usage-overview-h2.css` | Created | 448 |
| `src/renderer/styles/12-organization-home-bannerreset.css` | Created | 448 |
| `src/renderer/styles/13-companion-customization-preview--current.css` | Created | 445 |
| `src/renderer/styles/14-companion-customization-dropzoneaction.css` | Created | 447 |
| `src/renderer/styles/15-settings-dialogopen.css` | Created | 449 |
| `src/renderer/styles/16-settings-dialog-settings-toggle-inputchecked.css` | Created | 446 |
| `src/renderer/styles/17-learning-insightstate.css` | Created | 445 |
| `src/renderer/styles/18-live-task-detailscontent-div-p.css` | Created | 442 |
| `src/renderer/styles/19-history-message-listhistory-event-list.css` | Created | 447 |
| `src/renderer/styles/20-class-roster-access-note.css` | Created | 443 |
| `src/renderer/styles/21-class-detail-heroafter.css` | Created | 449 |
| `src/renderer/styles/22-member-add-result-details-p-strong.css` | Created | 445 |
| `src/renderer/styles/23-upload-previewheading.css` | Created | 449 |
| `src/renderer/styles/24-assignment-state.css` | Created | 363 |
| `src/renderer/styles/25-media.css` | Created | 446 |
| `src/renderer/styles/26-activity-studioprogress-span.css` | Created | 446 |
| `src/renderer/styles/27-directive-kind-switch-label.css` | Created | 450 |
| `src/renderer/styles/28-participant-review-actions.css` | Created | 447 |
| `src/renderer/styles/29-submission-complete-small.css` | Created | 447 |
| `src/renderer/styles/30-class-session-live.css` | Created | 160 |
| `src/renderer/use-push-to-talk.test.ts` | Updated | 582 |
| `src/renderer/use-push-to-talk.ts` | Updated | 494 |
| `src/renderer/voice-segmentation.ts` | Updated | 368 |
| `src/test-support/read-stylesheet.ts` | Created | 18 |
| `src/test-support/render-hook.tsx` | Created | 36 |
| `src/test-support/styles-preservation.test.ts` | Created | 26 |
| `src/test-support/task-fixture.ts` | Created | 21 |
| `vitest.config.mts` | Updated | 41 |

## Handoff

- Source ownership: `docs/frontend-architecture.md`.
- Audit inventory: `docs/frontend-source-inventory.md`.
- Open plan: `docs/frontend-refactoring-plan.md`.
- Review the source changes by feature ownership, then obtain explicit
  authorization to push/create a PR. Admin and tooling changes require full CI
  under the existing routing policy. Require the applicable final-revision
  checks before merging.
- Perform desktop/auxiliary/admin visual acceptance and shared teacher/student
  acceptance using `docs/testing/shared-test-environment.md`. Account availability,
  deployed revision, migrations and OS permissions remain unverified here.
- Begin native/backend work only with its separate compatibility design/review.

## PR preparation update

Rebased onto `08bdc19` (PR #68). Preserved membership-gated classroom startup,
listener teardown and stale-response invalidation in the extracted classroom
hooks. The upstream App membership/settings regression suite remains unchanged.
The earlier local validation results above precede this integration; final CI
will validate the rebased revision. User authorized PR creation and merge after
checks pass. npm audit reports three existing moderate advisories and no high or
critical advisories; dependencies remain unchanged.
