import { describe, expect, it } from 'vitest';

import { routeTaskRequest } from './task-request-router';

const route = (text: string, overrides: Partial<Parameters<typeof routeTaskRequest>[0]> = {}) =>
  routeTaskRequest({
    activityLaunchTarget: null,
    executionProfile: 'everyday',
    intent: 'work',
    requestedMode: 'auto',
    screenContext: 'auto',
    text,
    ...overrides,
  });

describe('routeTaskRequest', () => {
  it.each([
    'Show me how to do this Scratch exercise',
    'Chỉ tôi cách làm bài Scratch này',
    'Làm sao để làm bài tập này?',
  ])('routes visible teaching to Coach: %s', (text) => {
    expect(route(text)).toEqual({ route: 'coach', requiresObservation: true });
  });

  it.each([
    'Do it for me',
    'Click the blue button',
    'Làm hộ tôi bài này',
    'Gõ ABC vào ô này',
  ])('routes explicit execution to Agent: %s', (text) => {
    expect(route(text).route).toBe('agent');
  });

  it('routes classroom Help and Check to a grounded Coach turn', () => {
    expect(route('scratch', { intent: 'help' })).toEqual({
      route: 'coach',
      requiresObservation: true,
    });
  });

  it('honors explicit mode before text classification', () => {
    expect(route('click it', { requestedMode: 'coach' }).route).toBe('coach');
    expect(route('show me', { requestedMode: 'agent' }).route).toBe('agent');
  });

  it('keeps plain questions in the non-mutating Coach lane without capture', () => {
    expect(route('What is a variable?')).toEqual({
      route: 'coach',
      requiresObservation: false,
    });
  });

  it('keeps an explicit disabled screen policy even in Coach mode', () => {
    expect(route('Show me how to do this', { screenContext: 'disabled' })).toEqual({
      route: 'coach',
      requiresObservation: false,
    });
    expect(route('Show me', {
      activityLaunchTarget: 'current_surface',
      requestedMode: 'coach',
      screenContext: 'disabled',
    })).toEqual({ route: 'coach', requiresObservation: false });
  });
});

it.each(['none','workspace','current_surface'] as const)('forces %s assignment checks into the read-only lane', target => {
  expect(route('Run the code and mark it complete',{activityLaunchTarget:target,intent:'check',requestedMode:'agent'})).toEqual({route:'coach',requiresObservation:target==='current_surface'});
});
