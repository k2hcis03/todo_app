import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '@/lib/auth/session';
import { upsertGithubUser } from '@/lib/auth/users';
import { startTestDb, type TestDb } from './test-db';

// Route Handler가 쓰는 getDb를 인메모리 DB로 바꾼다. ensureIndexes 등 나머지는 실제 구현을 쓴다.
const holder = vi.hoisted(() => ({ db: undefined as unknown as Db, fail: false }));
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: async () => {
    if (holder.fail) throw new Error('mongo://secret-host:27017 연결 실패');
    return holder.db;
  },
}));
// connection()은 Next 런타임 밖에서는 동작하지 않으므로 no-op으로 대체한다.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}));

import * as goalsRoute from '@/app/api/goals/route';
import * as goalRoute from '@/app/api/goals/[id]/route';
import * as todosRoute from '@/app/api/todos/route';
import * as todoRoute from '@/app/api/todos/[id]/route';
import * as weeksRoute from '@/app/api/weeks/route';
import * as weekRoute from '@/app/api/weeks/[id]/route';

let t: TestDb;
let sessionToken: string;
beforeAll(async () => {
  t = await startTestDb();
  holder.db = t.db;
  // 모든 요청은 로그인한 사용자(소유자)의 세션 쿠키를 싣는다. 사용자 간 격리는 api-auth.test.ts에서 검증한다.
  const user = await upsertGithubUser(t.db, { githubId: 1, username: 'owner', avatarUrl: 'https://avatars.example/o.png' });
  sessionToken = (await createSession(t.db, user.id)).token;
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  holder.fail = false;
  await t.reset();
});

const MISSING_ID = '000000000000000000000000';
const url = (path: string) => `http://localhost${path}`;
/** 로그인 세션 쿠키를 붙인 요청 */
const req = (path: string, init: RequestInit = {}) =>
  new Request(url(path), { ...init, headers: { ...(init.headers as Record<string, string>), cookie: `session=${sessionToken}` } });
const json = (method: string, body: unknown) =>
  ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) satisfies RequestInit;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function post(route: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown) {
  const res = await route.POST(req(path, json('POST', body)));
  return { res, body: await res.json() };
}

async function seed() {
  const goal = (await post(goalsRoute, '/api/goals', { title: '건강', year: 2026 })).body;
  const week = (await post(weeksRoute, '/api/weeks', { title: '1주차', weekStart: '2026-10-19', goalId: goal.id })).body;
  return { goal, week };
}

describe('/api/goals', () => {
  it('POST는 201과 생성된 목표를, GET은 목록을 반환한다', async () => {
    const created = await post(goalsRoute, '/api/goals', { title: '건강', year: 2026 });
    expect(created.res.status).toBe(201);
    expect(created.body).toMatchObject({ title: '건강', year: 2026 });

    const list = await (await goalsRoute.GET(req('/api/goals'))).json();
    expect(list).toHaveLength(1);
  });

  it('PATCH로 수정하고 DELETE는 하위 항목까지 연쇄 삭제한 개수를 반환한다', async () => {
    const { goal, week } = await seed();
    await post(todosRoute, '/api/todos', { title: 'a', date: '2026-10-19', weekId: week.id });

    const patched = await goalRoute.PATCH(req(`/api/goals/${goal.id}`, json('PATCH', { title: '체력' })), ctx(goal.id));
    expect((await patched.json()).title).toBe('체력');

    const deleted = await goalRoute.DELETE(req(`/api/goals/${goal.id}`, { method: 'DELETE' }), ctx(goal.id));
    expect(await deleted.json()).toEqual({ weeks: 1, todos: 1 });
    const left = await todosRoute.GET(req('/api/todos'));
    expect(await left.json()).toEqual([]);
  });

  it('잘못된 id는 400, 없는 id는 404다', async () => {
    const bad = await goalRoute.GET(req('/api/goals/abc'), ctx('abc'));
    expect(bad.status).toBe(400);
    const missing = await goalRoute.GET(req(`/api/goals/${MISSING_ID}`), ctx(MISSING_ID));
    expect(missing.status).toBe(404);
  });
});

describe('/api/weeks', () => {
  it('목록은 진행률을 포함하며 할 일 없는 주간도 total 0, progress 0이다', async () => {
    const { week } = await seed();
    const list = await (await weeksRoute.GET(req('/api/weeks'))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: week.id, total: 0, done: 0, progress: 0 });
  });

  it('없는 목표로 주간 계획을 만들면 404, 잘못된 goalId 쿼리는 400이다', async () => {
    const res = await post(weeksRoute, '/api/weeks', { title: 'x', weekStart: '2026-10-19', goalId: MISSING_ID });
    expect(res.res.status).toBe(404);
    const bad = await weeksRoute.GET(req('/api/weeks?goalId=nope'));
    expect(bad.status).toBe(400);
  });

  it('DELETE는 소속 할 일 개수를 반환한다', async () => {
    const { week } = await seed();
    await post(todosRoute, '/api/todos', { title: 'a', date: '2026-10-19', weekId: week.id });
    const res = await weekRoute.DELETE(req(`/api/weeks/${week.id}`, { method: 'DELETE' }), ctx(week.id));
    expect(await res.json()).toEqual({ todos: 1 });
  });
});

describe('/api/todos', () => {
  it('존재하지 않는 weekId로 POST하면 404, 빈 제목이면 400이다', async () => {
    const missing = await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: MISSING_ID });
    expect(missing.res.status).toBe(404);

    const { week } = await seed();
    const empty = await post(todosRoute, '/api/todos', { title: '', date: '2026-10-19', weekId: week.id });
    expect(empty.res.status).toBe(400);
    expect(empty.body.issues[0].path).toBe('title');
  });

  it('새 할 일은 항상 todo로 만들어지며 요청의 status는 무시된다', async () => {
    const { week } = await seed();
    const created = await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: week.id });
    expect(created.res.status).toBe(201);
    expect(created.body.status).toBe('todo');

    const forced = await post(todosRoute, '/api/todos', { title: 'y', date: '2026-10-19', weekId: week.id, status: 'done' });
    expect(forced.body.status).toBe('todo');
  });

  it("PATCH {status:'doing'} 후 GET에서 doing으로 조회된다", async () => {
    const { week } = await seed();
    const todo = (await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: week.id })).body;
    const patched = await todoRoute.PATCH(req(`/api/todos/${todo.id}`, json('PATCH', { status: 'doing' })), ctx(todo.id));
    expect(patched.status).toBe(200);

    const got = await todoRoute.GET(req(`/api/todos/${todo.id}`), ctx(todo.id));
    expect((await got.json()).status).toBe('doing');
  });

  it('GET ?weekId=A는 주간 A의 할 일만 order 오름차순으로, date 필터도 지원한다', async () => {
    const { goal, week } = await seed();
    const other = (await post(weeksRoute, '/api/weeks', { title: '2주차', weekStart: '2026-10-26', goalId: goal.id })).body;
    await post(todosRoute, '/api/todos', { title: 'A1', date: '2026-10-19', weekId: week.id });
    await post(todosRoute, '/api/todos', { title: 'B1', date: '2026-10-27', weekId: other.id });
    await post(todosRoute, '/api/todos', { title: 'A2', date: '2026-10-20', weekId: week.id });

    const all = await (await todosRoute.GET(req(`/api/todos?weekId=${week.id}`))).json();
    expect(all.map((x: { title: string }) => x.title)).toEqual(['A1', 'A2']);

    const day = await (await todosRoute.GET(req(`/api/todos?weekId=${week.id}&date=2026-10-20`))).json();
    expect(day.map((x: { title: string }) => x.title)).toEqual(['A2']);

    expect((await todosRoute.GET(req('/api/todos?date=2026-02-30'))).status).toBe(400);
  });

  it('할 일의 weekId를 바꾸면 이전·새 주간의 진행률이 GET /api/weeks에서 모두 갱신된다', async () => {
    const { goal, week } = await seed();
    const w2 = (await post(weeksRoute, '/api/weeks', { title: '2주차', weekStart: '2026-10-26', goalId: goal.id })).body;
    const todo = (await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: week.id })).body;
    await todoRoute.PATCH(req(`/api/todos/${todo.id}`, json('PATCH', { status: 'done' })), ctx(todo.id));

    const before = await (await weeksRoute.GET(req('/api/weeks'))).json();
    expect(before.find((w: { id: string }) => w.id === week.id).progress).toBe(100);
    expect(before.find((w: { id: string }) => w.id === w2.id).progress).toBe(0);

    await todoRoute.PATCH(req(`/api/todos/${todo.id}`, json('PATCH', { weekId: w2.id })), ctx(todo.id));

    const after = await (await weeksRoute.GET(req('/api/weeks'))).json();
    expect(after.find((w: { id: string }) => w.id === week.id)).toMatchObject({ total: 0, progress: 0 });
    expect(after.find((w: { id: string }) => w.id === w2.id)).toMatchObject({ total: 1, done: 1, progress: 100 });
  });

  it('DELETE는 204를 반환하고 이후 조회는 404다', async () => {
    const { week } = await seed();
    const todo = (await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: week.id })).body;
    const res = await todoRoute.DELETE(req(`/api/todos/${todo.id}`, { method: 'DELETE' }), ctx(todo.id));
    expect(res.status).toBe(204);
    const gone = await todoRoute.GET(req(`/api/todos/${todo.id}`), ctx(todo.id));
    expect(gone.status).toBe(404);
  });

  it('빈 PATCH와 깨진 JSON은 400이다', async () => {
    const { week } = await seed();
    const todo = (await post(todosRoute, '/api/todos', { title: 'x', date: '2026-10-19', weekId: week.id })).body;
    const empty = await todoRoute.PATCH(req(`/api/todos/${todo.id}`, json('PATCH', {})), ctx(todo.id));
    expect(empty.status).toBe(400);

    const broken = await todosRoute.POST(
      req('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }),
    );
    expect(broken.status).toBe(400);
  });
});

describe('서버 오류', () => {
  it('DB 연결 실패는 내부 정보(호스트 등)를 숨기고 500으로 응답한다', async () => {
    holder.fail = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await goalsRoute.GET(req('/api/goals'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret-host');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
