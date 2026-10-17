import { describe, expect, it } from 'vitest';
import { formatPercent, weekProgress } from '@/lib/progress';

describe('weekProgress', () => {
  it('연결된 할 일이 0개면 0을 반환한다 (0으로 나누지 않음)', () => {
    expect(weekProgress([])).toBe(0);
  });

  it('3개 중 1개가 done이면 33.333…을 소수 그대로 반환한다', () => {
    const todos = [{ status: 'done' }, { status: 'todo' }, { status: 'doing' }] as const;
    expect(weekProgress(todos)).toBeCloseTo(33.3333333, 5);
  });

  it('전부 done이면 100, 하나도 done이 아니면 0이다', () => {
    expect(weekProgress([{ status: 'done' }, { status: 'done' }])).toBe(100);
    expect(weekProgress([{ status: 'todo' }, { status: 'doing' }])).toBe(0);
  });

  it('할 일을 삭제하면 분모와 분자가 함께 줄어든다', () => {
    const before = [{ status: 'done' }, { status: 'todo' }] as const;
    const after = before.filter((t) => t.status !== 'done');
    expect(weekProgress(before)).toBe(50);
    expect(weekProgress(after)).toBe(0);
  });
});

describe('formatPercent', () => {
  it('표시용으로만 정수로 반올림한다', () => {
    expect(formatPercent(33.3333)).toBe('33%');
    expect(formatPercent(66.6667)).toBe('67%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(100)).toBe('100%');
  });
});
