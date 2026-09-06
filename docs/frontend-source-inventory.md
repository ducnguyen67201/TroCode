# Frontend source inventory

Snapshot: baseline `cd9cdc2` → local `codex/frontend-refactor`, 2026-09-06.

All 83 original production files have a structural audit disposition below. The
review covers imports, component/helper responsibilities, effect ownership, and
existing test locations. Retained means no extraction was justified in this pass;
it does not claim exhaustive behavioral acceptance of that file.

Production: **83 → 204 files**, **36,138 → 39,260 physical lines**.
Files above 500 lines: **13 → 0**. Maximum frontend file: **494 lines**.
Additional lines are explicit imports, types, component interfaces and formatting.
Tests and generated admin output are excluded from these production metrics.

## Original file dispositions

| Original path | Before | After | Disposition |
| --- | ---: | ---: | --- |
| `apps/admin/src/App.tsx` | 54 | 54 | Retained: Application composition and entry gates |
| `apps/admin/src/api/adminApi.ts` | 169 | 169 | Retained: Admin HTTP boundary |
| `apps/admin/src/api/contracts.ts` | 185 | 185 | Retained: Admin response schemas |
| `apps/admin/src/components/CodeUsersDialog.tsx` | 139 | 139 | Retained: Code membership query and dialog |
| `apps/admin/src/components/CreateCodesFlow.tsx` | 203 | 203 | Retained: Code creation flow |
| `apps/admin/src/components/Dashboard.tsx` | 111 | 111 | Retained: Admin page composition and session exit |
| `apps/admin/src/components/EmptyState.tsx` | 17 | 17 | Retained: Empty State presentation/policy |
| `apps/admin/src/components/ErrorBoundary.tsx` | 47 | 47 | Retained: Error Boundary presentation/policy |
| `apps/admin/src/components/GrantCodeDialog.tsx` | 229 | 229 | Retained: Code selection and grant flow |
| `apps/admin/src/components/LoginPage.tsx` | 74 | 74 | Retained: Login Page presentation/policy |
| `apps/admin/src/components/Modal.tsx` | 40 | 40 | Retained: Dialog and Escape ownership |
| `apps/admin/src/components/SummaryCard.tsx` | 27 | 27 | Retained: Summary Card presentation/policy |
| `apps/admin/src/components/UsageChart.tsx` | 209 | 209 | Retained: Usage Chart presentation/policy |
| `apps/admin/src/hooks/useDebouncedValue.ts` | 12 | 12 | Retained: use Debounced Value presentation/policy |
| `apps/admin/src/hooks/useToast.ts` | 19 | 19 | Retained: use Toast presentation/policy |
| `apps/admin/src/lib/formatters.ts` | 113 | 113 | Retained: Admin display formatting |
| `apps/admin/src/main.tsx` | 17 | 17 | Retained: Admin renderer entry |
| `apps/admin/src/pages/AccessCodesPage.tsx` | 292 | 292 | Retained: Admin access code list and mutations |
| `apps/admin/src/pages/UsagePage.tsx` | 319 | 319 | Retained: Admin usage query and dashboard |
| `apps/admin/src/pages/UsersPage.tsx` | 506 | 327 | Split: Users page filters/mutations; table and query owner extracted |
| `apps/admin/src/styles.css` | 1,771 | 5 | Split: ordered admin style entry; expanded bytes preserved |
| `src/index.css` | 12,995 | 31 | Split: ordered desktop style entry; expanded bytes preserved |
| `src/renderer.tsx` | 102 | 102 | Retained: Desktop renderer entry and auxiliary window selection |
| `src/renderer/ActivityEditorPage.tsx` | 388 | 388 | Retained: Activity definition editing |
| `src/renderer/App.tsx` | 3,603 | 472 | Split: Application composition and entry gates |
| `src/renderer/AppUpdateButton.tsx` | 52 | 52 | Retained: Update action presentation |
| `src/renderer/AssignedActivitiesPage.tsx` | 190 | 190 | Retained: Assigned activities listing |
| `src/renderer/AttemptLaunchPage.tsx` | 634 | 486 | Split: Attempt loading, submissions and review; controls extracted |
| `src/renderer/AuthGate.tsx` | 167 | 167 | Retained: Desktop authentication and login gate |
| `src/renderer/BrandMark.tsx` | 19 | 19 | Retained: Brand Mark presentation/policy |
| `src/renderer/ClassSessionsPanel.tsx` | 486 | 486 | Retained: Class session management |
| `src/renderer/ClassroomBroadcastPreview.tsx` | 213 | 213 | Retained: Broadcast preview and review |
| `src/renderer/ClassroomExplanationPanel.tsx` | 295 | 295 | Retained: Student explanation lifecycle |
| `src/renderer/ClassroomSessionBar.tsx` | 307 | 307 | Retained: Classroom binding and participation actions |
| `src/renderer/CompanionCustomizationCard.tsx` | 690 | 355 | Split: Companion customization composition; form/gallery extracted |
| `src/renderer/CompanionPetNudge.tsx` | 62 | 62 | Retained: Companion Pet Nudge presentation/policy |
| `src/renderer/CompanionResponseCard.tsx` | 215 | 215 | Retained: Companion response presentation and keyboard actions |
| `src/renderer/CursorBuddy.tsx` | 95 | 95 | Retained: Cursor Buddy presentation/policy |
| `src/renderer/CursorCompanion.tsx` | 155 | 155 | Retained: Companion appearance and animation |
| `src/renderer/DesktopControlIndicator.tsx` | 142 | 142 | Retained: Desktop Control Indicator presentation/policy |
| `src/renderer/FacilitatorRunPage.tsx` | 877 | 382 | Split: Run loading and mutations; dashboard/controls/composer extracted |
| `src/renderer/GuidanceCallout.tsx` | 445 | 445 | Retained: Guidance playback lifecycle, existing audio helper retained |
| `src/renderer/GuidanceTargetMarker.tsx` | 19 | 19 | Retained: Guidance Target Marker presentation/policy |
| `src/renderer/HistoryPage.tsx` | 242 | 242 | Retained: Task history presentation |
| `src/renderer/InsightsPage.tsx` | 343 | 343 | Retained: Learning insights presentation |
| `src/renderer/KnowledgeHubPage.tsx` | 102 | 102 | Retained: Knowledge Hub Page presentation/policy |
| `src/renderer/MembershipGate.tsx` | 202 | 202 | Retained: Membership Gate presentation/policy |
| `src/renderer/OrganizationPage.tsx` | 804 | 409 | Split: Organization composition; profile/banner/member resources extracted |
| `src/renderer/PermissionOnboarding.tsx` | 211 | 211 | Retained: Permission Onboarding presentation/policy |
| `src/renderer/SettingsPage.tsx` | 1,054 | 286 | Split: Settings dialog, focus and section navigation |
| `src/renderer/SidebarClassWorkspaceSwitcher.tsx` | 134 | 134 | Retained: Sidebar Class Workspace Switcher presentation/policy |
| `src/renderer/SidebarPlanTitle.tsx` | 37 | 37 | Retained: Sidebar Plan Title presentation/policy |
| `src/renderer/SpaceDetailPage.tsx` | 659 | 356 | Split: Space tabs/materials/activity composition; people panel extracted |
| `src/renderer/SpaceLibrary.tsx` | 386 | 386 | Retained: Material listing and source actions |
| `src/renderer/SpacesPage.tsx` | 224 | 224 | Retained: Class workspace list and creation |
| `src/renderer/VoiceIsland.tsx` | 161 | 161 | Retained: Voice Island presentation/policy |
| `src/renderer/VoiceModeControl.tsx` | 168 | 168 | Retained: Voice Mode Control presentation/policy |
| `src/renderer/agent-activity-projection.ts` | 14 | 14 | Retained: agent activity projection presentation/policy |
| `src/renderer/app-language.ts` | 1,298 | 43 | Split: Translation lookup, locale labels and interpolation |
| `src/renderer/app-navigation.ts` | 28 | 28 | Retained: app navigation presentation/policy |
| `src/renderer/class-workspace.ts` | 77 | 77 | Retained: class workspace presentation/policy |
| `src/renderer/classroom-broadcast.css` | 71 | 71 | Retained: broadcast styles and import timing |
| `src/renderer/classroom-session-view.ts` | 121 | 121 | Retained: classroom session view presentation/policy |
| `src/renderer/classroom-voice-binding.ts` | 16 | 16 | Retained: classroom voice binding presentation/policy |
| `src/renderer/companion-animation.ts` | 85 | 85 | Retained: companion animation presentation/policy |
| `src/renderer/companion-state.ts` | 50 | 50 | Retained: Deferred cleanup candidate; only test consumers observed |
| `src/renderer/guidance-audio-playback.ts` | 216 | 216 | Retained: guidance audio playback presentation/policy |
| `src/renderer/history.ts` | 64 | 64 | Retained: history presentation/policy |
| `src/renderer/insights.ts` | 274 | 274 | Retained: insights presentation/policy |
| `src/renderer/language-options.ts` | 60 | 60 | Retained: language options presentation/policy |
| `src/renderer/membership.ts` | 29 | 29 | Retained: membership presentation/policy |
| `src/renderer/permission-onboarding.ts` | 132 | 132 | Retained: permission onboarding presentation/policy |
| `src/renderer/push-to-talk.ts` | 156 | 156 | Retained: push to talk presentation/policy |
| `src/renderer/task-execution.ts` | 95 | 95 | Retained: task execution presentation/policy |
| `src/renderer/transient-cursor-error.ts` | 70 | 70 | Retained: transient cursor error presentation/policy |
| `src/renderer/usage-presentation.ts` | 30 | 30 | Retained: usage presentation presentation/policy |
| `src/renderer/use-push-to-talk.ts` | 903 | 494 | Split: Capture/turn resource owner; shortcuts and completion extracted |
| `src/renderer/voice-capture-processor.worklet.js` | 45 | 45 | Retained: Audio processor entry; URL and location retained |
| `src/renderer/voice-capture.ts` | 138 | 138 | Retained: Microphone and worklet lifecycle |
| `src/renderer/voice-draft.ts` | 66 | 66 | Retained: voice draft presentation/policy |
| `src/renderer/voice-route.ts` | 31 | 31 | Retained: voice route presentation/policy |
| `src/renderer/voice-segmentation.ts` | 637 | 368 | Split: Audio segmenter; encoding/queue/assembly extracted |
| `src/screen-recording-registration-renderer.ts` | 1 | 1 | Retained: OS screen recording registration entry |

## New production module ownership

Feature directories own their named resource or presentation surface. App modules
connect features; they do not move subscriptions out of their resource hooks.

| Module | Lines | Owner |
| --- | ---: | --- |
| `apps/admin/src/components/UsersTable.tsx` | 161 | Admin users |
| `apps/admin/src/hooks/useUsers.ts` | 90 | Admin users |
| `apps/admin/src/lib/role-save-state.ts` | 6 | Admin users |
| `apps/admin/src/lib/user-pagination.ts` | 1 | Admin users |
| `apps/admin/src/styles/01-root.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `apps/admin/src/styles/02-usage-chart-legend-i.css` | 448 | Ordered CSS cascade; filename identifies first selector |
| `apps/admin/src/styles/03-tbody-trlast-child-td.css` | 449 | Ordered CSS cascade; filename identifies first selector |
| `apps/admin/src/styles/04-code-users-dialog.css` | 430 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/app/AppSettings.tsx` | 101 | App composition |
| `src/renderer/app/AppSidebar.tsx` | 319 | App composition |
| `src/renderer/app/AppWorkspace.tsx` | 292 | App composition |
| `src/renderer/app/NavigationIcon.tsx` | 73 | App composition |
| `src/renderer/features/account/OrganizationBanner.tsx` | 95 | account |
| `src/renderer/features/account/OrganizationMembers.tsx` | 131 | account |
| `src/renderer/features/account/banner-image.ts` | 19 | account |
| `src/renderer/features/account/member-pagination.ts` | 1 | account |
| `src/renderer/features/account/organization-presentation.ts` | 13 | account |
| `src/renderer/features/account/use-membership-activation.ts` | 83 | account |
| `src/renderer/features/account/use-membership-status.ts` | 77 | account |
| `src/renderer/features/account/use-organization-banner.ts` | 138 | account |
| `src/renderer/features/account/use-organization-members.ts` | 204 | account |
| `src/renderer/features/account/use-organization-profile.ts` | 112 | account |
| `src/renderer/features/account/use-organization.ts` | 124 | account |
| `src/renderer/features/classroom/AttemptControls.tsx` | 213 | classroom |
| `src/renderer/features/classroom/ClassDashboard.tsx` | 249 | classroom |
| `src/renderer/features/classroom/DirectiveComposer.tsx` | 267 | classroom |
| `src/renderer/features/classroom/RunControls.tsx` | 146 | classroom |
| `src/renderer/features/classroom/participant-status.ts` | 12 | classroom |
| `src/renderer/features/classroom/use-class-spaces.ts` | 165 | classroom |
| `src/renderer/features/classroom/use-teacher-selection.ts` | 134 | classroom |
| `src/renderer/features/companion/CompanionGenerator.tsx` | 263 | companion |
| `src/renderer/features/companion/CompanionImagePreview.tsx` | 99 | companion |
| `src/renderer/features/companion/CompanionLibrary.tsx` | 123 | companion |
| `src/renderer/features/companion/customization-types.ts` | 6 | companion |
| `src/renderer/features/companion/image-selection.ts` | 27 | companion |
| `src/renderer/features/companion/use-companion-customization.ts` | 178 | companion |
| `src/renderer/features/knowledge/SpacePeoplePanel.tsx` | 393 | knowledge |
| `src/renderer/features/settings/AboutSettingsSection.tsx` | 90 | settings |
| `src/renderer/features/settings/AccountSettingsSection.tsx` | 202 | settings |
| `src/renderer/features/settings/CompanionSettingsSection.tsx` | 91 | settings |
| `src/renderer/features/settings/ConnectedApplicationsCard.tsx` | 201 | settings |
| `src/renderer/features/settings/ConnectionsSettingsSection.tsx` | 22 | settings |
| `src/renderer/features/settings/GeneralSettingsSection.tsx` | 71 | settings |
| `src/renderer/features/settings/VoiceSettingsSection.tsx` | 121 | settings |
| `src/renderer/features/settings/app-update-presentation.ts` | 31 | settings |
| `src/renderer/features/settings/settings-navigation.tsx` | 103 | settings |
| `src/renderer/features/settings/settings-types.ts` | 49 | settings |
| `src/renderer/features/settings/use-app-preferences.ts` | 142 | settings |
| `src/renderer/features/settings/use-app-updates.ts` | 74 | settings |
| `src/renderer/features/settings/use-system-permissions.ts` | 214 | settings |
| `src/renderer/features/tasks/ActivityList.tsx` | 36 | tasks |
| `src/renderer/features/tasks/ComputerConnection.tsx` | 53 | tasks |
| `src/renderer/features/tasks/Conversation.tsx` | 37 | tasks |
| `src/renderer/features/tasks/LiveTaskRail.tsx` | 203 | tasks |
| `src/renderer/features/tasks/PendingInteractionCard.tsx` | 48 | tasks |
| `src/renderer/features/tasks/TaskContextPanel.tsx` | 139 | tasks |
| `src/renderer/features/tasks/TaskWorkspace.tsx` | 389 | tasks |
| `src/renderer/features/tasks/TerminalOutcome.tsx` | 54 | tasks |
| `src/renderer/features/tasks/example-tasks.ts` | 6 | tasks |
| `src/renderer/features/tasks/task-presentation.ts` | 43 | tasks |
| `src/renderer/features/tasks/task-session-projection.ts` | 42 | tasks |
| `src/renderer/features/tasks/task-view.ts` | 86 | tasks |
| `src/renderer/features/tasks/use-task-commands.ts` | 449 | tasks |
| `src/renderer/features/tasks/use-task-session.ts` | 186 | tasks |
| `src/renderer/features/tasks/use-transient-task-error.ts` | 37 | tasks |
| `src/renderer/features/tasks/use-workspace-selection.ts` | 77 | tasks |
| `src/renderer/features/voice/audio-level.ts` | 6 | voice |
| `src/renderer/features/voice/pcm-encoding.ts` | 99 | voice |
| `src/renderer/features/voice/segment-upload-queue.ts` | 60 | voice |
| `src/renderer/features/voice/segmentation-policy.ts` | 44 | voice |
| `src/renderer/features/voice/transcript-assembler.ts` | 98 | voice |
| `src/renderer/features/voice/use-voice-attempt-start.ts` | 221 | voice |
| `src/renderer/features/voice/use-voice-availability.ts` | 30 | voice |
| `src/renderer/features/voice/use-voice-feedback.ts` | 92 | voice |
| `src/renderer/features/voice/use-voice-mode-selection.ts` | 145 | voice |
| `src/renderer/features/voice/use-voice-shortcuts.ts` | 152 | voice |
| `src/renderer/features/voice/use-voice-turn-completion.ts` | 187 | voice |
| `src/renderer/features/voice/use-voice-turn-routing.ts` | 446 | voice |
| `src/renderer/features/voice/voice-diagnostics.ts` | 52 | voice |
| `src/renderer/features/voice/voice-input-policy.ts` | 78 | voice |
| `src/renderer/features/voice/voice-input-types.ts` | 106 | voice |
| `src/renderer/i18n/vi/account.ts` | 116 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/classroom-1.ts` | 352 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/classroom-2.ts` | 24 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/common-1.ts` | 351 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/common-2.ts` | 71 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/companion.ts` | 98 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/messages.ts` | 24 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/settings.ts` | 71 | Vietnamese domain dictionary |
| `src/renderer/i18n/vi/tasks.ts` | 187 | Vietnamese domain dictionary |
| `src/renderer/runtime-status.ts` | 17 | Initial renderer runtime presentation |
| `src/renderer/styles/01-root.css` | 444 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/02-permission-list-li.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/03-cursor-buddyimage.css` | 450 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/04-activity-form-widesource-picker.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/05-guidance-callout--rightbeforeguidance-callout--leftbefo.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/06-guidance-calloutanswer-input.css` | 441 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/07-keyframes.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/08-sidebar-class-workspacemenu-buttonhoversidebar-class-wo.css` | 445 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/09-sidebar-accountsign-outhovernotdisabled.css` | 449 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/10-voice-mode-controltalkvoice-mode-controlswitch.css` | 448 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/11-usage-overview-h2.css` | 448 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/12-organization-home-bannerreset.css` | 448 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/13-companion-customization-preview--current.css` | 445 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/14-companion-customization-dropzoneaction.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/15-settings-dialogopen.css` | 449 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/16-settings-dialog-settings-toggle-inputchecked.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/17-learning-insightstate.css` | 445 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/18-live-task-detailscontent-div-p.css` | 442 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/19-history-message-listhistory-event-list.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/20-class-roster-access-note.css` | 443 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/21-class-detail-heroafter.css` | 449 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/22-member-add-result-details-p-strong.css` | 445 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/23-upload-previewheading.css` | 449 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/24-assignment-state.css` | 363 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/25-media.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/26-activity-studioprogress-span.css` | 446 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/27-directive-kind-switch-label.css` | 450 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/28-participant-review-actions.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/29-submission-complete-small.css` | 447 | Ordered CSS cascade; filename identifies first selector |
| `src/renderer/styles/30-class-session-live.css` | 160 | Ordered CSS cascade; filename identifies first selector |

## Tests and deferred work

The existing push-to-talk regression suite remains cohesive at 582 lines; other
frontend suites remain below 500. New lifecycle suites are separated by task
commands, subscriptions, voice routing, capture lifecycle, roster and admin users.
Native/backend oversized test suites are inventoried by `npm run source:inventory`
and remain outside this frontend implementation.

The 26 existing production exceptions in `scripts/source-size-baseline.json` are
native, backend or shared-contract modules. Their baseline cannot grow in CI.
The provisional backend follow-up remains batch 9 in the refactoring plan.

No dead-code or dependency deletion was attempted. The unconfirmed
`companion-state.ts` candidate remains available with its tests.
