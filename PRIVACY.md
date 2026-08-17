# TroCode privacy policy

Effective date: August 17, 2026

TroCode is an open-source desktop agent. It can answer requests with a hosted
model and, when the user asks, observe and control applications on the user's
computer. This policy describes the network transfers made by the application
and the data stored locally or by an operator-configured service.

## Data sent to service providers

TroCode transfers data only for configured application features or actions the
user requests:

- **OpenAI:** typed task text, conversation messages, model tool results, and
  desktop observations needed for a task can be sent to the Responses API.
  Desktop observations can include screenshots and visible text. Push-to-talk
  audio is sent to OpenAI Realtime for transcription. Responses requests set
  `store: false`, but OpenAI's own service terms and retention rules still
  apply. See the [OpenAI privacy policy](https://openai.com/policies/privacy-policy/).
- **Google:** when the user chooses Google sign-in, TroCode sends the OAuth
  authorization request and receives verified identity claims and tokens. The
  application requests only OpenID, email, and profile scopes. See the
  [Google privacy policy](https://policies.google.com/privacy).
- **PostHog:** analytics is disabled unless an operator configures a PostHog
  project token. When enabled, TroCode sends app/platform/version fields,
  anonymous or signed-in identifiers, sign-in profile fields, task lifecycle
  counts, tool identifiers/operations, and voice-transcript character counts.
  It does not send task text, screenshots, URLs, document contents, file paths,
  tool arguments, or voice-transcript content to PostHog. GeoIP collection and
  automatic exception capture are disabled. See the
  [PostHog privacy policy](https://posthog.com/privacy).
- **ElevenLabs:** when an operator configures ElevenLabs companion speech,
  short assistant explanations are sent for text-to-speech generation. See the
  [ElevenLabs privacy policy](https://elevenlabs.io/privacy-policy).
- **GitHub and Electron's update service:** installed builds contact the fixed
  TroCode GitHub release feed to check for, download, and install application
  updates. Standard request metadata such as IP address and user agent can be
  processed by those services. See the
  [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **User-selected websites and applications:** when the user asks TroCode to
  navigate, type, upload, submit, or otherwise act in a third-party service,
  that service receives the information involved in the requested action under
  its own privacy policy. Consequential actions require confirmation in the
  cases enforced by TroCode's host policy.

## Data stored by TroCode

- Google session data is encrypted with the operating system's secure storage.
  Signing out deletes the saved Google session.
- Preferences, membership state, and a random analytics installation ID are
  stored locally in the Electron application-data directory.
- Task history is persisted only when the operator configures `DATABASE_URL`.
  It stores task requests, conversation messages, goal data, and lifecycle
  events under the verified Google user ID. Raw screenshots, OAuth tokens, and
  model-provider credentials are not stored in task history.
- Screenshots used during a task are kept in the active in-memory execution
  context and are not part of the persistent task-history schema.

The retention and deletion policy for an operator-configured PostgreSQL or
PostHog deployment is controlled by that operator. To request deletion from a
TroCode-operated deployment, contact the address below with the Google account
email used to sign in.

## Security

The Electron renderer is sandboxed. OAuth tokens, provider credentials,
analytics, database access, and computer-use execution remain in the trusted
main process behind validated IPC contracts. Credentials are not intentionally
included in analytics or release artifacts. See the
[security model](docs/security.md) for implementation details.

## Contact and changes

Privacy questions and deletion requests can be sent to
[danielbaker06072001@gmail.com](mailto:danielbaker06072001@gmail.com). Material
changes to this policy will be published in this repository with a new
effective date.
