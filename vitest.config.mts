import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/admin/src/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/main/agent/**/*.ts',
        'src/renderer/features/**/*.{ts,tsx}',
        'src/renderer/use-push-to-talk.ts',
        'src/renderer/voice-segmentation.ts',
        'apps/admin/src/hooks/**/*.ts',
      ],
      exclude: ['src/**/*.test.{ts,tsx}'],
      // Initial measured floors for extracted lifecycle owners. Raise as coverage grows.
      thresholds: {
        'src/renderer/features/tasks/use-task-commands.ts': {
          statements: 59,
          branches: 53,
          functions: 76,
          lines: 60,
        },
        'src/renderer/features/voice/use-voice-turn-routing.ts': {
          statements: 74,
          branches: 67,
          functions: 71,
          lines: 74,
        },
        'apps/admin/src/hooks/useUsers.ts': {
          statements: 85,
          branches: 73,
          functions: 71,
          lines: 92,
        },
      },
    },
  },
});
