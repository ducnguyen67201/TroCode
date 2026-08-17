import { describe, expect, it, vi } from 'vitest';

import { ElectronPresentationPresenter } from './electron-presentation-presenter';

describe('ElectronPresentationPresenter', () => {
  it('reveals the main window only for attention and terminal states', () => {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const showInteraction = vi.fn();
    const clearInteraction = vi.fn();
    const presenter = new ElectronPresentationPresenter(
      setState,
      reveal,
      reset,
      showInteraction,
      clearInteraction,
    );
    presenter.apply('working', null);
    expect(reveal).not.toHaveBeenCalled();
    expect(clearInteraction).toHaveBeenCalledWith(undefined);
    presenter.apply('needs_attention', null);
    expect(setState).toHaveBeenLastCalledWith('idle');
    expect(reset).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });
});
