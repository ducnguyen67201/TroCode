import { describe, expect, it, vi } from 'vitest';

import { ElectronPresentationPresenter } from './electron-presentation-presenter';

describe('ElectronPresentationPresenter', () => {
  it('reveals the main window only for attention and terminal states', () => {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const presenter = new ElectronPresentationPresenter(setState, reveal, reset);
    presenter.apply('working', null);
    expect(reveal).not.toHaveBeenCalled();
    presenter.apply('needs_attention', null);
    expect(setState).toHaveBeenLastCalledWith('idle');
    expect(reset).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });
});
