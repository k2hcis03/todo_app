import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from '@/lib/repo/goals';
import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from '@/lib/repo/todos';
import { createWeek, deleteWeek, getWeek, listWeeks, updateWeek } from '@/lib/repo/weeks';
import { startTestDb, type TestDb } from './test-db';

let t: TestDb;
const MISSING_ID = '000000000000000000000000';
/** 이 파일의 모든 호출이 사용하는 소유자. 사용자 간 격리는 ownership.test.ts에서 검증한다. */
const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await t.reset();
});

async function seed() {
  const goal = await createGoal(t.db, USER, { title: '건강', year: 2026 });
  const week = await createWeek(t.db, USER, { title: '1주차', weekStart: '2026-10-19', goalId: goal.id });
  return { goal, week };
}

describe('인덱스', () => {
  it('weeks.goalId, todos.weekId/status/date 인덱스가 있다', async () => {
    const weekKeys = (await t.db.collection('weeks').indexes()).map((i) => Object.keys(i.key).join(','));
    const todoKeys = (await t.db.collection('todos').indexes()).map((i) => Object.keys(i.key).join(','));
    expect(weekKeys).toContain('goalId');
    expect(todoKeys).toEqual(expect.arrayContaining(['weekId', 'status', 'date']));
  });
});

describe('goals', () => {
  it('생성·조회·수정·목록이 동작한다', async () => {
    const created = await createGoal(t.db, USER, { title: '건강', year: 2026 });
    expect(created.id).toMatch(/^[0-9a-f]{24}$/);
    expect((await getGoal(t.db, USER, created.id)).title).toBe('건강');

    const updated = await updateGoal(t.db, USER, created.id, { title: '체력 향상' });
    expect(updated.title).toBe('체력 향상');
    expect(updated.year).toBe(2026);
    expect(await listGoals(t.db, USER)).toHaveLength(1);
  });

  it('없는 목표 조회·수정은 404 AppError다', async () => {
    await expect(getGoal(t.db, USER, MISSING_ID)).rejects.toMatchObject({ status: 404 });
    await expect(updateGoal(t.db, USER, MISSING_ID, { title: 'x' })).rejects.toBeInstanceOf(AppError);
  });

  it('목표를 삭제하면 하위 주간 2개와 할 일 3개가 모두 삭제되어 고아 문서가 0건이다', async () => {
    const { goal, week } = await seed();
    const week2 = await createWeek(t.db, USER, { title: '2주차', weekStart: '2026-10-26', goalId: goal.id });
    await createTodo(t.db, USER, { title: 'a', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'b', date: '2026-10-20', weekId: week.id });
    await createTodo(t.db, USER, { title: 'c', date: '2026-10-27', weekId: week2.id });

    const other = await createGoal(t.db, USER, { title: '다른 목표', year: 2026 });
    const otherWeek = await createWeek(t.db, USER, { title: '다른 주', weekStart: '2026-10-19', goalId: other.id });
    await createTodo(t.db, USER, { title: 'keep', date: '2026-10-19', weekId: otherWeek.id });

    const removed = await deleteGoal(t.db, USER, goal.id);
    expect(removed).toEqual({ weeks: 2, todos: 3 });
    expect(await t.db.collection('goals').countDocuments({ title: '건강' })).toBe(0);
    // 다른 목표의 데이터는 남아야 한다
    expect(await listWeeks(t.db, USER, {})).toHaveLength(1);
    expect(await listTodos(t.db, USER, {})).toHaveLength(1);
  });
});

describe('weeks', () => {
  it('존재하지 않는 목표에는 주간 계획을 만들 수 없다 (404)', async () => {
    await expect(
      createWeek(t.db, USER, { title: 'x', weekStart: '2026-10-19', goalId: MISSING_ID }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('할 일이 없는 주간도 total 0, progress 0으로 목록에 포함된다', async () => {
    const { week } = await seed();
    const weeks = await listWeeks(t.db, USER, {});
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ id: week.id, total: 0, done: 0, progress: 0 });
  });

  it('진행률은 done / 전체 × 100이고 소수 그대로다', async () => {
    const { week } = await seed();
    const a = await createTodo(t.db, USER, { title: 'a', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'b', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'c', date: '2026-10-19', weekId: week.id });
    await updateTodo(t.db, USER, a.id, { status: 'done' });

    const got = await getWeek(t.db, USER, week.id);
    expect(got.total).toBe(3);
    expect(got.done).toBe(1);
    expect(got.progress).toBeCloseTo(33.3333333, 5);
  });

  it('goalId로 필터링하고 weekStart 오름차순으로 정렬한다', async () => {
    const g1 = await createGoal(t.db, USER, { title: 'g1', year: 2026 });
    const g2 = await createGoal(t.db, USER, { title: 'g2', year: 2026 });
    await createWeek(t.db, USER, { title: '나중', weekStart: '2026-11-02', goalId: g1.id });
    await createWeek(t.db, USER, { title: '먼저', weekStart: '2026-10-19', goalId: g1.id });
    await createWeek(t.db, USER, { title: '다른', weekStart: '2026-10-19', goalId: g2.id });

    const list = await listWeeks(t.db, USER, { goalId: g1.id });
    expect(list.map((w) => w.title)).toEqual(['먼저', '나중']);
  });

  it('주간 계획을 삭제하면 소속 할 일도 함께 삭제된다', async () => {
    const { goal, week } = await seed();
    const keepWeek = await createWeek(t.db, USER, { title: '유지', weekStart: '2026-10-26', goalId: goal.id });
    await createTodo(t.db, USER, { title: 'x', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'y', date: '2026-10-27', weekId: keepWeek.id });

    expect(await deleteWeek(t.db, USER, week.id)).toEqual({ todos: 1 });
    const left = await listTodos(t.db, USER, {});
    expect(left.map((x) => x.title)).toEqual(['y']);
  });

  it('주간 계획 수정 시 없는 목표로 옮길 수 없다 (404)', async () => {
    const { week } = await seed();
    await expect(updateWeek(t.db, USER, week.id, { goalId: MISSING_ID })).rejects.toMatchObject({ status: 404 });
  });
});

describe('todos', () => {
  it('존재하지 않는 주간 계획에는 할 일을 만들 수 없다 (404)', async () => {
    await expect(
      createTodo(t.db, USER, { title: 'x', date: '2026-10-19', weekId: MISSING_ID }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('새 할 일은 기본적으로 todo 상태이고 같은 주간의 기존 카드보다 order가 크다', async () => {
    const { week } = await seed();
    const first = await createTodo(t.db, USER, { title: '1', date: '2026-10-19', weekId: week.id });
    const second = await createTodo(t.db, USER, { title: '2', date: '2026-10-19', weekId: week.id });
    const third = await createTodo(t.db, USER, { title: '3', date: '2026-10-19', weekId: week.id });

    expect(first.status).toBe('todo');
    expect(second.order).toBeGreaterThan(first.order);
    expect(third.order).toBeGreaterThan(second.order);
  });

  it('PATCH로 status를 바꾸면 이후 조회에서 바뀐 값이 나온다', async () => {
    const { week } = await seed();
    const todo = await createTodo(t.db, USER, { title: 'x', date: '2026-10-19', weekId: week.id });
    await updateTodo(t.db, USER, todo.id, { status: 'doing' });
    expect((await getTodo(t.db, USER, todo.id)).status).toBe('doing');
  });

  it('다른 컬럼으로 옮기면 그 컬럼의 맨 아래(가장 큰 order)로 간다', async () => {
    const { week } = await seed();
    const a = await createTodo(t.db, USER, { title: 'a', date: '2026-10-19', weekId: week.id });
    const b = await createTodo(t.db, USER, { title: 'b', date: '2026-10-19', weekId: week.id });
    const moved = await updateTodo(t.db, USER, a.id, { status: 'doing' });
    expect(moved.order).toBeGreaterThan(b.order);
  });

  it('weekId별로 조회하면 해당 주간의 할 일만 order 오름차순으로 나온다', async () => {
    const { goal, week } = await seed();
    const other = await createWeek(t.db, USER, { title: '다른 주', weekStart: '2026-10-26', goalId: goal.id });
    await createTodo(t.db, USER, { title: 'A1', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'B1', date: '2026-10-27', weekId: other.id });
    await createTodo(t.db, USER, { title: 'A2', date: '2026-10-20', weekId: week.id });

    const list = await listTodos(t.db, USER, { weekId: week.id });
    expect(list.map((x) => x.title)).toEqual(['A1', 'A2']);
    expect(list.every((x) => x.weekId === week.id)).toBe(true);
  });

  it('목록은 삽입 순서가 아니라 order 오름차순이다 (옮긴 카드는 맨 아래로 간다)', async () => {
    const { week } = await seed();
    const a = await createTodo(t.db, USER, { title: 'A', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: 'B', date: '2026-10-19', weekId: week.id });
    // A를 다른 컬럼으로 옮기면 order가 B보다 커져 DB 삽입 순서(A, B)와 정렬 결과(B, A)가 달라진다
    await updateTodo(t.db, USER, a.id, { status: 'doing' });

    const list = await listTodos(t.db, USER, { weekId: week.id });
    expect(list.map((x) => x.title)).toEqual(['B', 'A']);
  });

  it('date 필터로 일일 목록을 조회한다', async () => {
    const { week } = await seed();
    await createTodo(t.db, USER, { title: '월', date: '2026-10-19', weekId: week.id });
    await createTodo(t.db, USER, { title: '화', date: '2026-10-20', weekId: week.id });
    const list = await listTodos(t.db, USER, { weekId: week.id, date: '2026-10-20' });
    expect(list.map((x) => x.title)).toEqual(['화']);
  });

  it('할 일의 weekId를 바꾸면 이전·새 주간의 진행률이 모두 갱신된다', async () => {
    const { goal, week } = await seed();
    const w2 = await createWeek(t.db, USER, { title: '2주차', weekStart: '2026-10-26', goalId: goal.id });
    const todo = await createTodo(t.db, USER, { title: 'x', date: '2026-10-19', weekId: week.id });
    await updateTodo(t.db, USER, todo.id, { status: 'done' });
    expect((await getWeek(t.db, USER, week.id)).progress).toBe(100);
    expect((await getWeek(t.db, USER, w2.id)).progress).toBe(0);

    await updateTodo(t.db, USER, todo.id, { weekId: w2.id });
    expect(await getWeek(t.db, USER, week.id)).toMatchObject({ total: 0, progress: 0 });
    expect(await getWeek(t.db, USER, w2.id)).toMatchObject({ total: 1, done: 1, progress: 100 });
  });

  it('수정 시 없는 주간 계획으로 옮길 수 없다 (404)', async () => {
    const { week } = await seed();
    const todo = await createTodo(t.db, USER, { title: 'x', date: '2026-10-19', weekId: week.id });
    await expect(updateTodo(t.db, USER, todo.id, { weekId: MISSING_ID })).rejects.toMatchObject({ status: 404 });
  });

  it('삭제하면 진행률의 분모·분자가 함께 갱신된다', async () => {
    const { week } = await seed();
    const a = await createTodo(t.db, USER, { title: 'a', date: '2026-10-19', weekId: week.id });
    const b = await createTodo(t.db, USER, { title: 'b', date: '2026-10-19', weekId: week.id });
    await updateTodo(t.db, USER, a.id, { status: 'done' });
    expect((await getWeek(t.db, USER, week.id)).progress).toBe(50);

    await deleteTodo(t.db, USER, a.id);
    expect(await getWeek(t.db, USER, week.id)).toMatchObject({ total: 1, done: 0, progress: 0 });
    await expect(getTodo(t.db, USER, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteTodo(t.db, USER, MISSING_ID)).rejects.toMatchObject({ status: 404 });
    expect((await getTodo(t.db, USER, b.id)).title).toBe('b');
  });
});
