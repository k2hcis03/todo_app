import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, deleteSession } from '@/lib/auth/session';
import { upsertGithubUser } from '@/lib/auth/users';
import { startTestDb, type TestDb } from './test-db';

const holder = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: async () => holder.db,
}));
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
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  t = await startTestDb();
  holder.db = t.db;
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await t.reset();
  await Promise.all(['users', 'sessions'].map((n) => t.db.collection(n).deleteMany({})));
  const a = await upsertGithubUser(t.db, { githubId: 1, username: 'alice', avatarUrl: 'https://a.example/a.png' });
  const b = await upsertGithubUser(t.db, { githubId: 2, username: 'bob', avatarUrl: 'https://a.example/b.png' });
  tokenA = (await createSession(t.db, a.id)).token;
  tokenB = (await createSession(t.db, b.id)).token;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const MISSING_ID = '000000000000000000000000';
const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function request(path: string, method = 'GET', options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.cookie = `session=${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(token: string, prefix: string) {
  const goal = await (await goalsRoute.POST(request('/api/goals', 'POST', { token, body: { title: `${prefix}목표`, year: 2026 } }))).json();
  const week = await (
    await weeksRoute.POST(request('/api/weeks', 'POST', { token, body: { title: `${prefix}주간`, weekStart: '2026-10-19', goalId: goal.id } }))
  ).json();
  const todo = await (
    await todosRoute.POST(request('/api/todos', 'POST', { token, body: { title: `${prefix}할 일`, date: '2026-10-19', weekId: week.id } }))
  ).json();
  return { goal, week, todo };
}

/** 모든 보호 대상 엔드포인트. 호출마다 새 Request를 만든다. */
const endpoints: Array<{ name: string; call: (opts?: { token?: string; headers?: Record<string, string>; body?: unknown }) => Promise<Response> }> = [
  { name: 'GET /api/goals', call: (o) => goalsRoute.GET(request('/api/goals', 'GET', o)) },
  { name: 'POST /api/goals', call: (o) => goalsRoute.POST(request('/api/goals', 'POST', { body: { title: 'x', year: 2026 }, ...o })) },
  { name: 'GET /api/goals/:id', call: (o) => goalRoute.GET(request(`/api/goals/${ID}`, 'GET', o), ctx(ID)) },
  { name: 'PATCH /api/goals/:id', call: (o) => goalRoute.PATCH(request(`/api/goals/${ID}`, 'PATCH', { body: { title: 'x' }, ...o }), ctx(ID)) },
  { name: 'DELETE /api/goals/:id', call: (o) => goalRoute.DELETE(request(`/api/goals/${ID}`, 'DELETE', o), ctx(ID)) },
  { name: 'GET /api/weeks', call: (o) => weeksRoute.GET(request('/api/weeks', 'GET', o)) },
  { name: 'POST /api/weeks', call: (o) => weeksRoute.POST(request('/api/weeks', 'POST', { body: { title: 'x', weekStart: '2026-10-19', goalId: ID }, ...o })) },
  { name: 'GET /api/weeks/:id', call: (o) => weekRoute.GET(request(`/api/weeks/${ID}`, 'GET', o), ctx(ID)) },
  { name: 'PATCH /api/weeks/:id', call: (o) => weekRoute.PATCH(request(`/api/weeks/${ID}`, 'PATCH', { body: { title: 'x' }, ...o }), ctx(ID)) },
  { name: 'DELETE /api/weeks/:id', call: (o) => weekRoute.DELETE(request(`/api/weeks/${ID}`, 'DELETE', o), ctx(ID)) },
  { name: 'GET /api/todos', call: (o) => todosRoute.GET(request('/api/todos', 'GET', o)) },
  { name: 'POST /api/todos', call: (o) => todosRoute.POST(request('/api/todos', 'POST', { body: { title: 'x', date: '2026-10-19', weekId: ID }, ...o })) },
  { name: 'GET /api/todos/:id', call: (o) => todoRoute.GET(request(`/api/todos/${ID}`, 'GET', o), ctx(ID)) },
  { name: 'PATCH /api/todos/:id', call: (o) => todoRoute.PATCH(request(`/api/todos/${ID}`, 'PATCH', { body: { status: 'done' }, ...o }), ctx(ID)) },
  { name: 'DELETE /api/todos/:id', call: (o) => todoRoute.DELETE(request(`/api/todos/${ID}`, 'DELETE', o), ctx(ID)) },
];

describe('로그인하지 않으면 접근할 수 없다 (401)', () => {
  it.each(endpoints)('$name — 쿠키 없음', async ({ call }) => {
    expect((await call()).status).toBe(401);
  });

  it.each(endpoints)('$name — 알 수 없는 세션 토큰', async ({ call }) => {
    expect((await call({ token: 'forged-token' })).status).toBe(401);
  });

  it('본문 파싱·입력 검증보다 먼저 401을 반환한다 (깨진 JSON도 400이 아니라 401)', async () => {
    const broken = await goalsRoute.POST(request('/api/goals', 'POST', { body: '{oops' }));
    expect(broken.status).toBe(401);
    const invalid = await todosRoute.POST(request('/api/todos', 'POST', { body: { title: '' } }));
    expect(invalid.status).toBe(401);
  });

  it('인증이 필요한 응답(200·401·404)은 공유 캐시에 저장되지 않도록 Cache-Control: private, no-store를 싣는다', async () => {
    const { goal } = await seed(tokenA, 'A');
    const ok = await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA }));
    const unauth = await goalsRoute.GET(request('/api/goals'));
    const missing = await goalRoute.GET(request(`/api/goals/${MISSING_ID}`, 'GET', { token: tokenA }), ctx(MISSING_ID));
    const created = await goalsRoute.POST(request('/api/goals', 'POST', { token: tokenA, body: { title: 'x', year: 2026 } }));
    for (const response of [ok, unauth, missing, created]) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(goal.id).toBeTruthy();
  });

  it('401 응답에는 데이터가 없다', async () => {
    const { goal } = await seed(tokenA, 'A');
    const res = await goalRoute.GET(request(`/api/goals/${goal.id}`), ctx(goal.id));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('A목표');
  });

  it('만료된 세션은 401이다', async () => {
    await t.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA }))).status).toBe(401);
  });

  it('로그아웃(세션 삭제) 뒤에는 같은 쿠키로 접근할 수 없다', async () => {
    expect((await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA }))).status).toBe(200);
    await deleteSession(t.db, tokenA);
    expect((await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA }))).status).toBe(401);
  });
});

describe('로그인한 사용자는 본인 데이터만 다룬다', () => {
  it('목록에는 자기 항목만 나온다', async () => {
    await seed(tokenA, 'A');
    await seed(tokenB, 'B');

    const goalsA = await (await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA }))).json();
    expect(goalsA.map((g: { title: string }) => g.title)).toEqual(['A목표']);
    const weeksB = await (await weeksRoute.GET(request('/api/weeks', 'GET', { token: tokenB }))).json();
    expect(weeksB.map((w: { title: string }) => w.title)).toEqual(['B주간']);
    const todosA = await (await todosRoute.GET(request('/api/todos', 'GET', { token: tokenA }))).json();
    expect(todosA.map((x: { title: string }) => x.title)).toEqual(['A할 일']);
  });

  it('B는 A의 id로 조회·수정·삭제할 수 없고 모두 404다', async () => {
    const { goal, week, todo } = await seed(tokenA, 'A');
    const cases: Array<[string, Promise<Response>]> = [
      ['GET goal', goalRoute.GET(request(`/api/goals/${goal.id}`, 'GET', { token: tokenB }), ctx(goal.id))],
      ['PATCH goal', goalRoute.PATCH(request(`/api/goals/${goal.id}`, 'PATCH', { token: tokenB, body: { title: '탈취' } }), ctx(goal.id))],
      ['DELETE goal', goalRoute.DELETE(request(`/api/goals/${goal.id}`, 'DELETE', { token: tokenB }), ctx(goal.id))],
      ['GET week', weekRoute.GET(request(`/api/weeks/${week.id}`, 'GET', { token: tokenB }), ctx(week.id))],
      ['PATCH week', weekRoute.PATCH(request(`/api/weeks/${week.id}`, 'PATCH', { token: tokenB, body: { title: '탈취' } }), ctx(week.id))],
      ['DELETE week', weekRoute.DELETE(request(`/api/weeks/${week.id}`, 'DELETE', { token: tokenB }), ctx(week.id))],
      ['GET todo', todoRoute.GET(request(`/api/todos/${todo.id}`, 'GET', { token: tokenB }), ctx(todo.id))],
      ['PATCH todo', todoRoute.PATCH(request(`/api/todos/${todo.id}`, 'PATCH', { token: tokenB, body: { status: 'done', title: '탈취' } }), ctx(todo.id))],
      ['DELETE todo', todoRoute.DELETE(request(`/api/todos/${todo.id}`, 'DELETE', { token: tokenB }), ctx(todo.id))],
    ];
    for (const [name, response] of cases) {
      expect(await response.then((r) => r.status), name).toBe(404);
    }

    // A의 데이터는 그대로다
    const after = await (await todoRoute.GET(request(`/api/todos/${todo.id}`, 'GET', { token: tokenA }), ctx(todo.id))).json();
    expect(after).toMatchObject({ title: 'A할 일', status: 'todo' });
    expect(await t.db.collection('goals').countDocuments()).toBe(1);
  });

  it('없는 id와 남의 id는 같은 404 본문이라 존재 여부를 알 수 없다', async () => {
    const { todo } = await seed(tokenA, 'A');
    const other = await (await todoRoute.GET(request(`/api/todos/${todo.id}`, 'GET', { token: tokenB }), ctx(todo.id))).json();
    const missing = await (await todoRoute.GET(request(`/api/todos/${MISSING_ID}`, 'GET', { token: tokenB }), ctx(MISSING_ID))).json();
    expect(other).toEqual(missing);
  });

  it('B는 A의 목표·주간 아래에 하위 항목을 만들 수 없다 (404)', async () => {
    const { goal, week } = await seed(tokenA, 'A');
    const w = await weeksRoute.POST(request('/api/weeks', 'POST', { token: tokenB, body: { title: 'x', weekStart: '2026-10-19', goalId: goal.id } }));
    const td = await todosRoute.POST(request('/api/todos', 'POST', { token: tokenB, body: { title: 'x', date: '2026-10-19', weekId: week.id } }));
    expect(w.status).toBe(404);
    expect(td.status).toBe(404);
  });

  it('쿼리로 A의 weekId·goalId를 지목해도 B에게는 빈 목록이다', async () => {
    const { goal, week } = await seed(tokenA, 'A');
    expect(await (await todosRoute.GET(request(`/api/todos?weekId=${week.id}`, 'GET', { token: tokenB }))).json()).toEqual([]);
    expect(await (await weeksRoute.GET(request(`/api/weeks?goalId=${goal.id}`, 'GET', { token: tokenB }))).json()).toEqual([]);
  });

  it('본문에 userId를 넣어도 무시되고 소유자는 세션의 사용자다', async () => {
    const { goal } = await seed(tokenB, 'B');
    const spoof = await goalsRoute.POST(request('/api/goals', 'POST', { token: tokenA, body: { title: '위조', year: 2026, userId: goal.id } }));
    expect(spoof.status).toBe(201);
    const goalsB = await (await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenB }))).json();
    expect(goalsB.map((g: { title: string }) => g.title)).toEqual(['B목표']);
  });
});

describe('CSRF: 다른 출처의 변경 요청은 403이다', () => {
  const evil = { origin: 'https://evil.example', host: 'localhost:3000' };

  it('로그인 쿠키가 있어도 Origin이 다르면 POST/PATCH/DELETE 모두 403이고 데이터는 바뀌지 않는다', async () => {
    const { goal, week, todo } = await seed(tokenA, 'A');
    const responses = [
      goalsRoute.POST(request('/api/goals', 'POST', { token: tokenA, headers: evil, body: { title: 'x', year: 2026 } })),
      todoRoute.PATCH(request(`/api/todos/${todo.id}`, 'PATCH', { token: tokenA, headers: evil, body: { status: 'done' } }), ctx(todo.id)),
      todoRoute.DELETE(request(`/api/todos/${todo.id}`, 'DELETE', { token: tokenA, headers: evil }), ctx(todo.id)),
      weekRoute.DELETE(request(`/api/weeks/${week.id}`, 'DELETE', { token: tokenA, headers: evil }), ctx(week.id)),
      goalRoute.DELETE(request(`/api/goals/${goal.id}`, 'DELETE', { token: tokenA, headers: evil }), ctx(goal.id)),
    ];
    for (const r of responses) expect((await r).status).toBe(403);

    expect(await t.db.collection('goals').countDocuments()).toBe(1);
    expect(await t.db.collection('todos').countDocuments({ status: 'todo' })).toBe(1);
  });

  it('같은 출처이거나 Origin이 없는 요청은 허용한다', async () => {
    const same = { origin: 'http://localhost:3000', host: 'localhost:3000' };
    const a = await goalsRoute.POST(request('/api/goals', 'POST', { token: tokenA, headers: same, body: { title: 'x', year: 2026 } }));
    const b = await goalsRoute.POST(request('/api/goals', 'POST', { token: tokenA, body: { title: 'y', year: 2026 } }));
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('읽기(GET)는 출처와 무관하게 검사하지 않는다', async () => {
    expect((await goalsRoute.GET(request('/api/goals', 'GET', { token: tokenA, headers: evil }))).status).toBe(200);
  });
});
