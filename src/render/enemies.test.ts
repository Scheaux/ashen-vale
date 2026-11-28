import { describe, expect, it } from 'vitest';
import { selectDetailedIds, type DetailedSlotCandidate } from './enemies';

function candidate(
  id: string,
  distance: number,
  overrides: Partial<DetailedSlotCandidate> = {},
): DetailedSlotCandidate {
  return { id, distance, boss: false, visible: true, windup: false, ...overrides };
}

describe('detailed rig budget', () => {
  it('reserves a slot for an in-range windup beyond eight nearer idle enemies', () => {
    const candidates = [
      candidate('windup-far', 15.5, { windup: true }),
      ...Array.from({ length: 9 }, (_, i) => candidate(`idle-${i + 1}`, i + 1)),
    ];
    const selected = selectDetailedIds(candidates);
    expect(selected).toHaveLength(8);
    expect(selected[0]).toBe('windup-far');
    expect(selected).not.toContain('idle-9');
  });

  it('leaves out-of-range windups to the far-silhouette cue', () => {
    const selected = selectDetailedIds([
      candidate('windup-beyond-range', 20, { windup: true }),
      candidate('idle-near', 5),
    ]);
    expect(selected).toEqual(['idle-near']);
  });

  it('keeps the nearest windups when more than eight are committed', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      candidate(`windup-${i + 1}`, i + 1, { windup: true }));
    const selected = selectDetailedIds(candidates);
    expect(selected).toEqual([
      'windup-1', 'windup-2', 'windup-3', 'windup-4',
      'windup-5', 'windup-6', 'windup-7', 'windup-8',
    ]);
  });

  it('puts the boss first and honours the boss-fight detail cap', () => {
    const selected = selectDetailedIds([
      candidate('boss', 40, { boss: true }),
      ...Array.from({ length: 6 }, (_, i) => candidate(`windup-${i + 1}`, i + 1, { windup: true })),
      candidate('near', 2),
    ], 4);
    expect(selected).toEqual(['boss', 'windup-1', 'windup-2', 'windup-3']);
  });

  it('keeps idle enemies near/on-screen and always includes the boss', () => {
    const selected = selectDetailedIds([
      candidate('near', 5),
      candidate('far', 30),
      candidate('offscreen-near', 6, { visible: false }),
      candidate('boss', 40, { boss: true }),
    ]);
    expect(selected).toContain('near');
    expect(selected).toContain('boss');
    expect(selected).not.toContain('far');
    expect(selected).not.toContain('offscreen-near');
  });
});
