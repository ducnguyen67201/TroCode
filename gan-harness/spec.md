# TroCode guided walkthrough pacing control

Design a compact, high-confidence interaction for choosing how TroCode advances through a sequence of visual teaching callouts.

Context:

- TroCode moves a visible companion cursor to worksheet questions or interface targets and shows a brief chat-style explanation.
- A walkthrough has an ordered sequence such as 1 / 16, 2 / 16, and so on.
- The product needs two pacing modes: user-controlled Next and automatic progression.
- The choice must be easy for a first-time user, usable without opening the main TroCode window, and visually compatible with the small cursor companion and floating guidance callout.
- The interface must avoid a modal or large setup choice before every task.
- The user must always be able to pause or stop automatic progression.
- The mode may depend on the task: short/sensitive/complex explanations benefit from manual control, while repetitive worksheets benefit from autoplay.
- Text-to-speech is future work and is not part of this design.

Required recommendation:

1. Choose the default mode and explain why.
2. Define the first-run choice, in-callout controls, keyboard behavior, and how the preference is remembered.
3. Specify exact concise labels and microcopy.
4. Describe the visual hierarchy and motion behavior near the cursor.
5. Cover accessibility, accidental activation, and the transition between manual and autoplay.
6. Keep the proposal implementation-ready but do not edit production source files.

Output: `gan-harness/autoplay-control-proposal.md`.

