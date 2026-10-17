import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.stop();
});

/** getDb는 연결을 globalThis에 캐시하므로 케이스마다 닫고 비워서 환경 변수를 다시 읽게 한다. */
async function resetDbCache() {
  const cache = (globalThis as { __todoMongo?: { client?: Promise<{ close(): Promise<void> }> } }).__todoMongo;
  if (cache?.client) await (await cache.client).close();
  delete (globalThis as { __todoMongo?: unknown }).__todoMongo;
  vi.resetModules();
}

beforeEach(resetDbCache);
afterEach(async () => {
  await resetDbCache();
  vi.unstubAllEnvs();
});

describe('getDb 환경 변수', () => {
  it('MONGODB_DB가 설정되어 있으면 그 이름의 DB를 쓴다', async () => {
    vi.stubEnv('MONGODB_URI', t.uri);
    vi.stubEnv('MONGODB_DB', 'custom_db');
    const { getDb } = await import('@/lib/db');
    expect((await getDb()).databaseName).toBe('custom_db');
  });

  it('MONGODB_DB가 없으면 기본 DB 이름(todo_app)을 쓴다 — 배포 환경에서 이 변수를 빼먹어도 로그인이 500으로 깨지지 않는다', async () => {
    vi.stubEnv('MONGODB_URI', t.uri);
    vi.stubEnv('MONGODB_DB', '');
    const { getDb } = await import('@/lib/db');
    expect((await getDb()).databaseName).toBe('todo_app');
  });

  it('MONGODB_URI가 없으면 필요한 변수를 알려 주는 오류를 던진다', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const { getDb } = await import('@/lib/db');
    await expect(getDb()).rejects.toThrow(/MONGODB_URI/);
  });
});
