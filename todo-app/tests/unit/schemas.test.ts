import { describe, expect, it } from 'vitest';
import {
  dateString,
  goalInputSchema,
  objectIdString,
  todoCreateSchema,
  todoUpdateSchema,
  weekInputSchema,
} from '@/lib/schemas';

const OID = '507f1f77bcf86cd799439011';

describe('todoCreateSchema', () => {
  it('요청에 status가 있어도 버린다 (새 할 일의 상태는 저장소가 todo로 정한다)', () => {
    const parsed = todoCreateSchema.parse({ title: '운동', date: '2026-10-19', weekId: OID, status: 'done' });
    expect(parsed).not.toHaveProperty('status');
  });

  it('빈 제목(공백만 포함)은 거부한다', () => {
    expect(todoCreateSchema.safeParse({ title: '', date: '2026-10-19', weekId: OID }).success).toBe(false);
    expect(todoCreateSchema.safeParse({ title: '   ', date: '2026-10-19', weekId: OID }).success).toBe(false);
  });

  it('제목 앞뒤 공백은 제거한다', () => {
    const parsed = todoCreateSchema.parse({ title: '  운동  ', date: '2026-10-19', weekId: OID });
    expect(parsed.title).toBe('운동');
  });

  it('weekId가 없으면 거부한다 (주간 계획은 필수)', () => {
    expect(todoCreateSchema.safeParse({ title: '운동', date: '2026-10-19' }).success).toBe(false);
  });

});

describe('todoUpdateSchema', () => {
  it('일부 필드만 허용하고 빈 객체는 거부한다', () => {
    expect(todoUpdateSchema.safeParse({ status: 'doing' }).success).toBe(true);
    expect(todoUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('알 수 없는 status는 거부한다', () => {
    expect(todoUpdateSchema.safeParse({ status: 'blocked' }).success).toBe(false);
  });
});

describe('dateString', () => {
  it('YYYY-MM-DD 형식만 허용한다', () => {
    expect(dateString.safeParse('2026-10-19').success).toBe(true);
    expect(dateString.safeParse('2026/10/19').success).toBe(false);
    expect(dateString.safeParse('26-10-19').success).toBe(false);
    expect(dateString.safeParse('2026-10-19T00:00:00Z').success).toBe(false);
  });

  it('존재하지 않는 날짜는 거부한다', () => {
    expect(dateString.safeParse('2026-02-30').success).toBe(false);
    expect(dateString.safeParse('2026-13-01').success).toBe(false);
    expect(dateString.safeParse('2028-02-29').success).toBe(true);
  });
});

describe('objectIdString', () => {
  it('24자리 16진수만 허용한다', () => {
    expect(objectIdString.safeParse(OID).success).toBe(true);
    expect(objectIdString.safeParse('abc').success).toBe(false);
    expect(objectIdString.safeParse('zzzzzzzzzzzzzzzzzzzzzzzz').success).toBe(false);
    // 12바이트 문자열은 ObjectId.isValid가 통과시키지만 우리 API에서는 거부한다
    expect(objectIdString.safeParse('abcdefghijkl').success).toBe(false);
  });
});

describe('goalInputSchema / weekInputSchema', () => {
  it('목표는 제목과 연도를 요구한다', () => {
    expect(goalInputSchema.safeParse({ title: '건강', year: 2026 }).success).toBe(true);
    expect(goalInputSchema.safeParse({ title: '', year: 2026 }).success).toBe(false);
    expect(goalInputSchema.safeParse({ title: '건강', year: 1999 }).success).toBe(false);
  });

  it('주간 계획은 제목, 시작일, 목표 id를 요구한다', () => {
    expect(weekInputSchema.safeParse({ title: '1주차', weekStart: '2026-10-19', goalId: OID }).success).toBe(true);
    expect(weekInputSchema.safeParse({ title: '1주차', weekStart: '2026-10-19' }).success).toBe(false);
  });
});
