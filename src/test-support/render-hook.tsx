import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Minimal real-React harness; callers own browser environment and teardown.
export async function renderHook<Props, Value>(
  useValue: (props: Props) => Value,
  initialProps: Props,
) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  let value: Value;
  function Harness({ props }: { props: Props }) {
    value = useValue(props);
    return null;
  }
  async function rerender(props: Props) {
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness props={props} />
        </StrictMode>,
      ),
    );
  }
  await rerender(initialProps);
  return {
    get current() {
      return value!;
    },
    rerender,
    unmount: () => act(async () => root.unmount()),
  };
}
