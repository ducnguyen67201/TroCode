import { readFile } from 'node:fs/promises';

const fixturePath = new URL(
  '../test/fixtures/inference-cost/call-shapes.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
for (const scenario of fixture.scenarios) {
  const before = scenario.beforeMicroUsd;
  const after = scenario.afterMicroUsd;
  const savedPercent =
    before === 0 ? 0 : Math.round(((before - after) / before) * 100);
  console.info(
    JSON.stringify({
      afterMicroUsd: after,
      beforeMicroUsd: before,
      savedPercent,
      scenario: scenario.id,
    }),
  );
}
