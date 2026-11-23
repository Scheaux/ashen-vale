import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameLoop } from './loop';

afterEach(() => vi.unstubAllGlobals());

describe('GameLoop', () => {
  it('stops remaining catch-up ticks on death and renders the latest state while stopped', () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const render = vi.fn();
    const fixedUpdate = vi.fn(() => loop.setRunning(false));
    const loop = new GameLoop({ fixedUpdate, render });
    loop.setRunning(true);
    loop.start();
    frame(0);
    frame(90); // time for five ticks if nothing stops the loop
    expect(fixedUpdate).toHaveBeenCalledTimes(1);
    expect(render.mock.lastCall?.[1]).toBe(1);
    frame(100);
    expect(fixedUpdate).toHaveBeenCalledTimes(1);
    expect(render.mock.lastCall?.[1]).toBe(1);
  });
});
