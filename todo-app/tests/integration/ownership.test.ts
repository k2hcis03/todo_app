import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from '@/lib/repo/goals';
import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from '@/lib/repo/todos';
import { createWeek, deleteWeek, getWeek, listWeeks, updateWeek } from '@/lib/repo/weeks';
import { startTestDb, type TestDb } from './test-db';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await t.reset();
});

/** A의 목표·주간·할 일 한 벌 */
async function seedA() {
  const goal = await createGoal(t.db, A, { title: 'A의 목표', year: 2026 });
  const week = await createWeek(t.db, A, { title: 'A의 주간', weekStart: '2026-10-19', goalId: goal.id });
  const todo = await createTodo(t.db, A, { title: 'A의 할 일', date: '2026-10-19', weekId: week.id });
  return { goal, week, todo };
}

describe('저장되는 문서', () => {
  it('goals·weeks·todos 문서에 소유자 userId(ObjectId)가 저장된다', async () => {
    await seedA();
    for (const name of ['goals', 'weeks', 'todos']) {
      const doc = await t.db.collection(name).findOne({});
      expect(doc?.userId).toEqual(new ObjectId(A));
    }
  });

  it('API 응답 DTO에는 userId를 싣지 않는다', async () => {
    const { goal, week, todo } = await seedA();
    expect(goal).not.toHaveProperty('userId');
    expect(week).not.toHaveProperty('userId');
    expect(todo).not.toHaveProperty('userId');
    expect(await getTodo(t.db, A, todo.id)).not.toHaveProperty('userId');
  });
});

describe('다른 사용자는 볼 수 없다', () => {
  it('목록에 나타나지 않는다', async () => {
    await seedA();
    expect(await listGoals(t.db, B)).toEqual([]);
    expect(await listWeeks(t.db, B, {})).toEqual([]);
    expect(await listTodos(t.db, B, {})).toEqual([]);
    expect(await listGoals(t.db, A)).toHaveLength(1);
  });

  it('A의 id를 알아도 B는 조회할 수 없고 404다 (존재를 알려주지 않는다)', async () => {
    const { goal, week, todo } = await seedA();
    await expect(getGoal(t.db, B, goal.id)).rejects.toMatchObject({ status: 404 });
    await expect(getWeek(t.db, B, week.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTodo(t.db, B, todo.id)).rejects.toMatchObject({ status: 404 });
  });

  it('필터(goalId, weekId)로 A의 데이터를 지목해도 B에게는 비어 있다', async () => {
    const { goal, week } = await seedA();
    expect(await listWeeks(t.db, B, { goalId: goal.id })).toEqual([]);
    expect(await listTodos(t.db, B, { weekId: week.id })).toEqual([]);
  });

  it('userId가 없는 기존 문서는 어떤 사용자에게도 보이지 않는다', async () => {
    const goalId = new ObjectId();
    const weekId = new ObjectId();
    const now = new Date();
    await t.db.collection('goals').insertOne({ _id: goalId, title: '옛 목표', year: 2025, createdAt: now, updatedAt: now });
    await t.db.collection('weeks').insertOne({ _id: weekId, title: '옛 주간', weekStart: '2025-01-06', goalId, createdAt: now, updatedAt: now });
    await t.db.collection('todos').insertOne({
      _id: new ObjectId(), title: '옛 할 일', date: '2025-01-06', status: 'todo', weekId, order: 1, createdAt: now, updatedAt: now,
    });

    for (const user of [A, B]) {
      expect(await listGoals(t.db, user)).toEqual([]);
      expect(await listWeeks(t.db, user, {})).toEqual([]);
      expect(await listTodos(t.db, user, {})).toEqual([]);
      await expect(getGoal(t.db, user, goalId.toHexString())).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe('다른 사용자는 바꿀 수 없다', () => {
  it('B가 A의 항목을 수정하면 404이고 값이 바뀌지 않는다', async () => {
    const { goal, week, todo } = await seedA();
    await expect(updateGoal(t.db, B, goal.id, { title: '탈취' })).rejects.toMatchObject({ status: 404 });
    await expect(updateWeek(t.db, B, week.id, { title: '탈취' })).rejects.toMatchObject({ status: 404 });
    await expect(updateTodo(t.db, B, todo.id, { status: 'done', title: '탈취' })).rejects.toMatchObject({ status: 404 });

    expect((await getGoal(t.db, A, goal.id)).title).toBe('A의 목표');
    expect((await getWeek(t.db, A, week.id)).title).toBe('A의 주간');
    expect(await getTodo(t.db, A, todo.id)).toMatchObject({ title: 'A의 할 일', status: 'todo' });
  });

  it('B가 A의 항목을 삭제하면 404이고 데이터는 남는다 (연쇄 삭제도 일어나지 않는다)', async () => {
    const { goal, week, todo } = await seedA();
    await expect(deleteGoal(t.db, B, goal.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWeek(t.db, B, week.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteTodo(t.db, B, todo.id)).rejects.toMatchObject({ status: 404 });

    expect(await listGoals(t.db, A)).toHaveLength(1);
    expect(await listWeeks(t.db, A, {})).toHaveLength(1);
    expect(await listTodos(t.db, A, {})).toHaveLength(1);
  });

  it('B는 A의 목표 아래에 주간 계획을, A의 주간 아래에 할 일을 만들 수 없다 (404)', async () => {
    const { goal, week } = await seedA();
    await expect(createWeek(t.db, B, { title: 'x', weekStart: '2026-10-26', goalId: goal.id })).rejects.toMatchObject({ status: 404 });
    await expect(createTodo(t.db, B, { title: 'x', date: '2026-10-26', weekId: week.id })).rejects.toMatchObject({ status: 404 });
    expect(await t.db.collection('weeks').countDocuments()).toBe(1);
    expect(await t.db.collection('todos').countDocuments()).toBe(1);
  });

  it('자기 할 일을 남의 주간으로, 자기 주간을 남의 목표로 옮길 수 없다 (404)', async () => {
    const { goal, week } = await seedA();
    const bGoal = await createGoal(t.db, B, { title: 'B의 목표', year: 2026 });
    const bWeek = await createWeek(t.db, B, { title: 'B의 주간', weekStart: '2026-10-19', goalId: bGoal.id });
    const bTodo = await createTodo(t.db, B, { title: 'B의 할 일', date: '2026-10-19', weekId: bWeek.id });

    await expect(updateTodo(t.db, B, bTodo.id, { weekId: week.id })).rejects.toMatchObject({ status: 404 });
    await expect(updateWeek(t.db, B, bWeek.id, { goalId: goal.id })).rejects.toMatchObject({ status: 404 });
    expect((await getTodo(t.db, B, bTodo.id)).weekId).toBe(bWeek.id);
  });

  it('각자 자기 데이터는 독립적으로 쓰고 진행률은 자기 할 일만 센다', async () => {
    const a = await seedA();
    const bGoal = await createGoal(t.db, B, { title: 'B의 목표', year: 2026 });
    const bWeek = await createWeek(t.db, B, { title: 'B의 주간', weekStart: '2026-10-19', goalId: bGoal.id });
    const bTodo = await createTodo(t.db, B, { title: 'B의 할 일', date: '2026-10-19', weekId: bWeek.id });
    await updateTodo(t.db, B, bTodo.id, { status: 'done' });

    expect(await getWeek(t.db, B, bWeek.id)).toMatchObject({ total: 1, done: 1, progress: 100 });
    expect(await getWeek(t.db, A, a.week.id)).toMatchObject({ total: 1, done: 0, progress: 0 });
  });

  it('목표를 지워도 다른 사용자의 데이터는 건드리지 않는다', async () => {
    const a = await seedA();
    const bGoal = await createGoal(t.db, B, { title: 'B의 목표', year: 2026 });
    const bWeek = await createWeek(t.db, B, { title: 'B의 주간', weekStart: '2026-10-19', goalId: bGoal.id });
    await createTodo(t.db, B, { title: 'B의 할 일', date: '2026-10-19', weekId: bWeek.id });

    expect(await deleteGoal(t.db, A, a.goal.id)).toEqual({ weeks: 1, todos: 1 });
    expect(await listGoals(t.db, B)).toHaveLength(1);
    expect(await listWeeks(t.db, B, {})).toHaveLength(1);
    expect(await listTodos(t.db, B, {})).toHaveLength(1);
  });
});

describe('인덱스', () => {
  it('goals·weeks·todos에 userId 인덱스가 있다', async () => {
    for (const name of ['goals', 'weeks', 'todos']) {
      const keys = (await t.db.collection(name).indexes()).map((i) => Object.keys(i.key));
      expect(keys.some((k) => k[0] === 'userId')).toBe(true);
    }
  });
});
