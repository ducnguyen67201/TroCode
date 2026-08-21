import assert from 'node:assert/strict';
import test from 'node:test';

import { interruptionDetails } from '../src/backend-agent-runtime.mjs';

const calendarCreate = {
  kind: 'create_resource',
  resourceKind: 'calendar_event',
  reversibility: 'reversible',
  externality: 'cloud_private',
  communication: 'none',
  overwrite: 'none',
  sensitiveDataTransfer: false,
};

test('backend SDK interruption carries a typed effect and conservative policy metadata', () => {
  const details = interruptionDetails(
    {
      rawItem: {
        type: 'function_call',
        name: 'computer__control',
        callId: 'call-1',
        arguments: JSON.stringify({
          operation: 'click_element',
          effect: calendarCreate,
          input: { ref: 'e1' },
        }),
      },
    },
    [{ toolId: 'computer.control', operations: ['click_element'] }],
    3,
  );

  assert.deepEqual(details.effect, calendarCreate);
  assert.equal(details.intentRevision, 3);
  assert.equal(details.consequential, true);
  assert.equal(details.approvalRequired, true);
  assert.equal(details.authorizationSource, 'none');
});

test('backend interruption rejects illegal communication metadata', () => {
  assert.throws(() => interruptionDetails(
    {
      rawItem: {
        type: 'function_call',
        name: 'computer__control',
        callId: 'call-2',
        arguments: JSON.stringify({
          operation: 'click_element',
          effect: { ...calendarCreate, communication: 'invite' },
          input: {},
        }),
      },
    },
    [{ toolId: 'computer.control', operations: ['click_element'] }],
    1,
  ));
});
