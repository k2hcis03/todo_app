import { describe, expect, it } from 'vitest';
import { mondayOf, todayString } from '@/lib/dates';

describe('todayString', () => {
  it('로컬 날짜를 YYYY-MM-DD로 반환한다', () => {
    expect(todayString(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(todayString(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('mondayOf', () => {
  it('주중 날짜는 그 주 월요일을 반환한다', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19'); // 수요일
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // 월요일
  });

  it('일요일은 직전 월요일에 속한다', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });

  it('월·연도 경계를 넘어도 올바르다', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29');
    expect(mondayOf('2026-03-01')).toBe('2026-02-23');
  });
});
