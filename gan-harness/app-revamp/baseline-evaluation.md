# Baseline evaluation

Baseline source: existing renderer before the app-revamp styling pass, inspected against `spec.md` and `eval-rubric.md`.

## Starting score

- Design Quality: 5.9 / 10
- Originality: 5.8 / 10
- Craft: 6.2 / 10
- Functionality: 8.0 / 10
- Weighted score: 6.13 / 10

## Highest-leverage criteria

1. Main shell must feel intentionally framed: warm sidebar, bright workspace, precise border, and one controlled elevation layer.
2. Agent view needs a distinctive focal composition that communicates autonomous execution without becoming decorative clutter.
3. Composer must be visually dominant and crisp, with the voice status and submit action reading as one polished workflow.
4. Right rail should behave like useful operational context, not a stack of generic cards.
5. The inherited visual system must stay coherent across History, Insights, Settings, live task, terminal, and interaction states.

## Baseline findings

The starting UI already had strong TroCode identity and functional breadth, but it read more like a conventional dashboard than the reference's calm, elegant application shell. The major gap was visual decisiveness: the page relied on repeated soft cards and broad glow/shadow treatments, while the Agent view lacked a memorable focal area. Typography, borders, and spacing were solid but not sharp enough to feel award-level.

Functionality risk was low because the intended scope is renderer markup and CSS only; the main risk is accidental visual regression across secondary views and smaller desktop widths.
