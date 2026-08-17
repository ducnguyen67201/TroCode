# TroCode design evaluation rubric

Score each category from 0–10, multiply by its weight, and sum the result. Passing requires a weighted score of at least 7.5/10 and no major accessibility or functional regression.

## Design Quality (weight: 0.35)

- Strong hierarchy, spacing, proportion, typography, and visual balance.
- Warm shell and bright workspace feel precise, calm, and premium.
- TroCode yellow/charcoal palette is concentrated and intentional.
- Cards, borders, radii, and elevation form a coherent system without visual haze.
- Agent view has a clear focal point and composer priority at realistic desktop sizes.

## Originality (weight: 0.30)

- The result is recognizably TroCode rather than a literal Flow clone.
- Autonomous-agent concepts such as bounded execution, live state, or outcome focus inform the visual language.
- At least one distinctive compositional or interaction idea elevates the interface beyond a conventional dashboard.
- Visual decisions feel authored rather than template-derived.

## Craft (weight: 0.25)

- Details hold up across navigation, top bar, composer, context rail, supporting pages, and state variants.
- Type scale, alignment, icons, control heights, focus states, motion, and responsive transitions are polished.
- CSS remains maintainable and uses existing tokens coherently.
- No accidental overflow, clipping, illegible contrast, or fragile one-off styling.

## Functionality (weight: 0.10)

- Existing buttons, forms, live-task states, navigation, and supporting pages remain usable.
- Semantics, keyboard focus, reduced motion, and responsive layout remain intact.
- Lint, typecheck, tests, and package/build verification pass.

## Evaluator question

Would this feel at home in a design-award shortlist while still behaving like the existing TroCode application? Identify the highest-leverage improvements needed to reach that bar.

