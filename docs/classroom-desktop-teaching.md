# Teaching in student applications

The v3 teacher flow is **select class material → edit section, language and instructions → Send to class**. A default lesson downloads the pinned original to each student's Tro material cache, opens it with the operating system, verifies its external window and explains the visible content with voice, captions and pointers.

The alternative **What students already have open** uses the current external window. A named class source can also be paired with **Use an already-open window**. A readable PDF, image, document or editor may be explained without a source attachment in this mode. Availability depends on the installed viewer and capture permissions; universal format or application support is not claimed.

Opening now has a computer-use continuation before the teaching agent starts. After downloading and requesting the original file's OS launch, Tro observes the external window. For recognized Windows or macOS app choosers, it uses CUA element references to reveal installed apps, select a suitable document viewer, clear an observed “Always use” checkbox if necessary, and choose a one-time Open control. Every action uses fresh observed controls; a successful click is followed by another observation until the actual document is verified. The chooser itself cannot be treated as the material, even if its title contains the filename.

This opening loop uses bounded host rules and semantic CUA controls; it does not make an LLM call or use guessed screenshot coordinates. Supported chooser labels include English and Vietnamese, with known viewers for the supported file types. A chooser without usable accessibility controls or a recognized viewer still needs student selection. The model-driven explanation starts only after verification. An active accepted lesson authorizes opening and navigation within the verified material, without another classroom permission prompt.

Opening uses at most eight observations per attempt, with cancellable waits for app startup. Resume continues an already-launched file's visible chooser without downloading or launching it again. Chooser actions are journaled before dispatch: an uncertain result or a crash during a click cannot become an automatic retry. An explicit native acknowledgement can confirm a click that closes its dialog; the destination document still needs independent verification. No default file association, app installation, save, or submission is performed. Local diagnostic events record lesson ID, opening action kind and outcome, without file paths or document content.

Tro guides students through the material using computer use and visible pointers. The teacher does not choose a separate navigation mode, and the student does not need a second navigation checkbox. Tro can scroll, page, zoom, focus observed document content, or open Find and fill its empty verified field within the active accepted lesson. It cannot click arbitrary links, submit work, or use generic terminal/computer tools. Unsupported controls stop with a recovery message. Pause, Stop, opt-out and restart revoke the active execution. Existing OS accessibility and screen-recording permissions still apply. Students can navigate manually at any time, and practice continues to hand control back to them.

A demonstration can create an Untitled scratch tab in an already verified VS Code window and type the reviewed example into its empty editor. It requires an allowed demonstration step, the Activity's answer-reveal permission, and an active accepted lesson. Tro does not overwrite existing work, run the example, save it, or submit it. If the file opened in another app, the student can open it in VS Code and choose that window. Workspace Activities retain their existing trusted-workspace requirement; this lesson flow uses current-surface or no-launch Activities.

**Continue explaining** starts another child on the same step, with a fresh observation and recent explanation history. **Next step** is available after the teaching round reports that the step is covered. Questions stay within the parent lesson. Practice hands control back without starting an agent; Check retains the existing criterion-based Coach path and must capture the student's actual screen for v3.

## Recovery

| State | Student action |
|---|---|
| App chooser visible | Tro follows supported one-time opening controls. If no supported viewer/control is available, select the app manually and Resume. |
| File unavailable or association missing | If Tro cannot finish opening, open the file in a suitable app, choose its window, then Resume; alternatively choose a local document and Resume. |
| Window hidden, changed or ambiguous | Bring the intended document forward and use Choose material window. |
| Capture unavailable | Enable screen recording and accessibility, then Resume. |
| Existing work in the example editor | Use a new empty Untitled VS Code editor. |
| Unknown native action | Inspect the screen and Stop. Tro will not replay it. |
| Teacher shows Not received | Check the student's session, connection and build; v3 requires an updated student client. |
| Send receipt unknown | Reconcile that receipt; do not resend the same lesson under a new identity. |

## Contracts and execution

The envelope remains version 1. Plans use v3 with an explicit surface on every step: `resource_app` or `current_window`, and a `navigation` field retained for wire compatibility. New teacher plans set `navigation: tro`; updated student clients treat both legacy values as metadata rather than a separate permission gate. The old local `desktopControlConsent` journal field remains readable but is not used as execution authority. Its renderer/preload/IPC toggle has been removed. Signed plan digests and stored envelopes are not rewritten. `current_screen` is a v3 resource. The Rust and TypeScript corpus covers legacy digests, omitted versus null surfaces, invalid combinations and v3 round trips. No published migration changes are required.

Context/feed requests negotiate `maxPlanVersion=3`. A request for v2 receives a v2-compatible response, and no query preserves the legacy response shape. Filtering newer plans retains the unfiltered sequence cursor. The student publishes its negotiated capability before processing lessons; the backend verifies v3 capability before claiming a v3 execution. Teacher progress identifies older clients that need an update.

`GET /v1/attempts/:anchor/session-lessons/:lesson/resources/:resource/file` authorizes the student, active lesson, membership, target Activity, pinned source version, role, readiness and archive status before issuing a short-lived original-file ticket. Original downloads stream with a 25 MiB bound, verify byte count and SHA-256, and use an account-scoped cache. Tickets, native paths, PIDs and window IDs remain outside renderer-visible lesson state. Material open receipts are stored separately in the encrypted journal before dispatch.

Automatic opening accepts PDF, plain text, Markdown, PNG/JPEG and standard DOCX/PPTX/XLSX extensions with matching MIME types. The current class uploader and ingestion service still determine which originals can be uploaded. Other readable formats can use an already-open window. Macro/executable/script formats are not automatically launched. Modified cached files are preserved. Originals are retained rather than automatically deleting a file that a native application may still have open; incomplete downloads are removed.

V3 Explain/Help/Demonstrate children use LocalAgentRuntime with only `lesson_observe`, `lesson_navigate`, `lesson_present`, `lesson_demonstrate` and `lesson_finish`. Tool discovery, frozen resolution and dispatch all retain the lesson scope. Host checks run again at dispatch, and tool execution is serialized. Native identity is verified afresh; screenshot-only observations include visual content in the evidence fingerprint. Pointers are revalidated immediately before presentation. No second narration-model call is made. The short turn request preserves the current question; the observation tool supplies full reviewed steps, guidance policy, bounded source context and recent history without exceeding the SDK request limit.

Explain/Help children reserve at most four model turns; native demonstrations can reserve up to eight because scratch creation, observation and typing need separate turns. These are conservative durable reservations, never refunds, within the unchanged eight-model-per-step and 64-model-per-lesson caps. Steps also retain the 16-observation and 20-action limits. A demonstration that consumes all eight turns leaves no model budget for follow-up on that step.

## Verification status

The implementation includes shared-contract, backend authorization/version, download/integrity, native-window, tool-policy, lifecycle and teacher-edit-race regression coverage. These tests have not yet been executed for this branch. CI is the repository's verification gate; a passing final revision and real macOS/Windows acceptance are required before rollout.

For native acceptance, use separate teacher/student accounts in **Python Foundations — Sample Class**, Session 1, Activity **Python cơ bản: Tạo lời chào cá nhân**, with both clients and the same staging backend on the new revision. Start with `01-python-bai-hoc.md`, then PDF, image, browser and VS Code cases. Verify receipt, actual external content, narration, pointers, automatic navigation without an extra prompt, manual scrolling, pause/stop, follow-up and unknown-outcome recovery. No native app/OS combination is certified by source inspection or mocked tests alone.
