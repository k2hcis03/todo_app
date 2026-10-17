import { execFileSync, spawnSync } from 'node:child_process';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateUserId } from '../../scripts/migrate-user-id.mjs';
import { upsertGithubUser } from '@/lib/auth/users';
import { listGoals, getGoal } from '@/lib/repo/goals';
import { listTodos } from '@/lib/repo/todos';
import { listWeeks } from '@/lib/repo/weeks';
import { startTestDb, type TestDb } from './test-db';

let t: TestDb;
let alice: { id: string };
let bob: { id: string };

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await t.reset();
  await t.db.collection('users').deleteMany({});
  alice = await upsertGithubUser(t.db, { githubId: 1, username: 'Alice', avatarUrl: 'https://a.example/a.png' });
  bob = await upsertGithubUser(t.db, { githubId: 2, username: 'bob', avatarUrl: 'https://a.example/b.png' });
});

/** userId가 없는 기존(v1) 데이터: 목표 2개, 주간 2개, 할 일 3개 */
async function seedLegacy() {
  const now = new Date();
  const goals = [new ObjectId(), new ObjectId()];
  const weeks = [new ObjectId(), new ObjectId()];
  await t.db.collection('goals').insertMany(goals.map((_id, i) => ({ _id, title: `옛 목표 ${i}`, year: 2025, createdAt: now, updatedAt: now })));
  await t.db.collection('weeks').insertMany(
    weeks.map((_id, i) => ({ _id, title: `옛 주간 ${i}`, weekStart: '2025-01-06', goalId: goals[i], createdAt: now, updatedAt: now })),
  );
  await t.db.collection('todos').insertMany(
    [0, 1, 2].map((i) => ({
      _id: new ObjectId(), title: `옛 할 일 ${i}`, date: '2025-01-06', status: 'todo', weekId: weeks[i % 2], order: i + 1, createdAt: now, updatedAt: now,
    })),
  );
  return { goals, weeks };
}

const unowned = (name: string) => t.db.collection(name).countDocuments({ userId: null });

describe('migrateUserId', () => {
  it('기본(dry-run)은 대상 개수만 알려주고 아무것도 바꾸지 않는다', async () => {
    await seedLegacy();
    const result = await migrateUserId(t.db, { githubLogin: 'alice' });

    expect(result).toMatchObject({ applied: false, user: { username: 'Alice' }, counts: { goals: 2, weeks: 2, todos: 3 } });
    expect(await unowned('goals')).toBe(2);
    expect(await unowned('weeks')).toBe(2);
    expect(await unowned('todos')).toBe(3);
  });

  it('--apply면 userId가 없는 목표·주간·할 일을 모두 지정한 사용자에게 할당한다', async () => {
    await seedLegacy();
    const result = await migrateUserId(t.db, { githubLogin: 'alice', apply: true });

    expect(result).toMatchObject({ applied: true, counts: { goals: 2, weeks: 2, todos: 3 } });
    for (const name of ['goals', 'weeks', 'todos']) expect(await unowned(name)).toBe(0);
    expect((await t.db.collection('goals').findOne({}))?.userId).toEqual(new ObjectId(alice.id));
  });

  it('마이그레이션 뒤에는 소유자에게만 보이고 다른 사용자에게는 보이지 않는다', async () => {
    const { goals } = await seedLegacy();
    await migrateUserId(t.db, { githubLogin: 'alice', apply: true });

    expect(await listGoals(t.db, alice.id)).toHaveLength(2);
    expect(await listWeeks(t.db, alice.id, {})).toHaveLength(2);
    expect(await listTodos(t.db, alice.id, {})).toHaveLength(3);
    expect(await listGoals(t.db, bob.id)).toEqual([]);
    await expect(getGoal(t.db, bob.id, goals[0].toHexString())).rejects.toMatchObject({ status: 404 });
  });

  it('이미 소유자가 있는 문서는 건드리지 않는다', async () => {
    await seedLegacy();
    const now = new Date();
    const bobsGoal = new ObjectId();
    await t.db.collection('goals').insertOne({ _id: bobsGoal, userId: new ObjectId(bob.id), title: 'bob의 목표', year: 2026, createdAt: now, updatedAt: now });

    const result = await migrateUserId(t.db, { githubLogin: 'alice', apply: true });
    expect(result.counts.goals).toBe(2);
    expect((await t.db.collection('goals').findOne({ _id: bobsGoal }))?.userId).toEqual(new ObjectId(bob.id));
  });

  it('여러 번 실행해도 결과가 같다 (멱등)', async () => {
    await seedLegacy();
    await migrateUserId(t.db, { githubLogin: 'alice', apply: true });
    const again = await migrateUserId(t.db, { githubLogin: 'bob', apply: true });

    expect(again.counts).toEqual({ goals: 0, weeks: 0, todos: 0 });
    // 두 번째 실행(다른 사용자 지정)이 이미 할당된 데이터를 가로채지 않는다
    expect(await listGoals(t.db, alice.id)).toHaveLength(2);
    expect(await listGoals(t.db, bob.id)).toEqual([]);
  });

  it('GitHub 로그인명은 대소문자를 구분하지 않고 찾는다', async () => {
    await seedLegacy();
    expect((await migrateUserId(t.db, { githubLogin: 'ALICE' })).user.username).toBe('Alice');
  });

  it('대상 사용자가 없으면 아무것도 바꾸지 않고 오류를 던진다', async () => {
    await seedLegacy();
    await expect(migrateUserId(t.db, { githubLogin: 'nobody', apply: true })).rejects.toThrow(/nobody/);
    expect(await unowned('goals')).toBe(2);
    expect(await unowned('todos')).toBe(3);
  });

  it('같은 사용자명이 2건 이상이면(이름 변경 후 재사용 등) 잘못 할당하지 않고 중단한다', async () => {
    await seedLegacy();
    await upsertGithubUser(t.db, { githubId: 3, username: 'alice', avatarUrl: 'https://a.example/a2.png' });

    await expect(migrateUserId(t.db, { githubLogin: 'alice', apply: true })).rejects.toThrow(/2/);
    expect(await unowned('goals')).toBe(2);
    expect(await unowned('todos')).toBe(3);
  });

  it('GitHub 로그인명이 없으면 오류를 던진다', async () => {
    await expect(migrateUserId(t.db, { apply: true })).rejects.toThrow(/github-login/);
    await expect(migrateUserId(t.db, { githubLogin: '   ', apply: true })).rejects.toThrow(/github-login/);
  });

  it('로그인명에 정규식 특수문자가 있어도 다른 사용자와 매칭되지 않는다', async () => {
    await seedLegacy();
    await expect(migrateUserId(t.db, { githubLogin: '.*', apply: true })).rejects.toThrow();
    expect(await unowned('goals')).toBe(2);
  });
});

describe('CLI (npm run migrate:user-id)', () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['scripts/migrate-user-id.mjs', ...args], {
      env: { ...process.env, MONGODB_URI: t.uri, MONGODB_DB: t.dbName },
      encoding: 'utf8',
    });

  it('--apply 없이 실행하면 dry-run이며 변경하지 않는다', async () => {
    await seedLegacy();
    const out = run(['--github-login', 'alice']);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/dry-run/i);
    expect(out.stdout).toContain('goals: 2');
    expect(await unowned('goals')).toBe(2);
  });

  it('--apply로 실행하면 변경하고 연결 문자열을 출력하지 않는다', async () => {
    await seedLegacy();
    const out = run(['--github-login', 'alice', '--apply']);
    expect(out.status).toBe(0);
    expect(await unowned('goals')).toBe(0);
    expect(out.stdout + out.stderr).not.toContain(t.uri);
  });

  it('없는 사용자면 종료 코드 1로 끝나고 아무것도 바꾸지 않는다', async () => {
    await seedLegacy();
    const out = run(['--github-login', 'nobody', '--apply']);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/nobody/);
    expect(await unowned('goals')).toBe(2);
  });

  it('--github-login 없이 실행하면 사용법을 알려주고 실패한다', () => {
    const out = run([]);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/github-login/);
  });

  it('npm 스크립트가 등록되어 있다', () => {
    const pkg = JSON.parse(execFileSync(process.execPath, ['-p', "JSON.stringify(require('./package.json').scripts)"], { encoding: 'utf8' }));
    expect(pkg['migrate:user-id']).toBe('node scripts/migrate-user-id.mjs');
  });
});
