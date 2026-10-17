import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, getSessionUser } from '@/lib/auth/session';
import { upsertGithubUser } from '@/lib/auth/users';
import { startTestDb, type TestDb } from './test-db';

// 라우트가 쓰는 getDb를 인메모리 DB로, connection()은 no-op으로 바꾼다 (NextResponse 등 나머지는 실제 구현).
const holder = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: async () => holder.db,
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}));

import * as callbackRoute from '@/app/auth/github/callback/route';
import * as startRoute from '@/app/auth/github/route';
import * as logoutRoute from '@/app/auth/logout/route';
import * as meRoute from '@/app/api/me/route';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
  holder.db = t.db;
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await Promise.all(['users', 'sessions'].map((n) => t.db.collection(n).deleteMany({})));
  vi.stubEnv('GITHUB_CLIENT_ID', 'test-client-id');
  vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-client-secret-value');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BASE = 'http://localhost:3000';
const profile = { githubId: 42, username: 'octocat', avatarUrl: 'https://avatars.example/octocat.png' };

/** Set-Cookie 헤더들을 { 이름: { value, attrs } } 로 파싱한다. */
function setCookies(res: Response) {
  const out: Record<string, { value: string; attrs: string }> = {};
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(';');
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs: attrs.join(';').toLowerCase() };
  }
  return out;
}

const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

function mockGithub(options: { token?: unknown; user?: unknown } = {}) {
  const fn = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/login/oauth/access_token')) {
      return Response.json(options.token ?? { access_token: 'gho_secret_token' });
    }
    return Response.json(options.user ?? { id: profile.githubId, login: profile.username, avatar_url: profile.avatarUrl });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function startLogin(base = BASE) {
  const res = await startRoute.GET(new Request(`${base}/auth/github`));
  const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
  return { res, state, cookie: setCookies(res).oauth_state };
}

const callback = (query: string, cookies: Record<string, string> = {}, base = BASE) =>
  callbackRoute.GET(new Request(`${base}/auth/github/callback?${query}`, { headers: { cookie: cookieHeader(cookies) } }));

describe('GET /auth/github', () => {
  it('state 쿠키를 설정하고 client_id와 state가 담긴 GitHub 승인 URL로 302 리다이렉트한다', async () => {
    const { res, state, cookie } = await startLogin();
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(location.toString()).not.toContain('test-client-secret-value');

    expect(cookie.value).toBe(state);
    expect(cookie.attrs).toContain('httponly');
    expect(cookie.attrs).toContain('samesite=lax');
    expect(cookie.attrs).toContain('max-age=600');
    expect(cookie.attrs).toContain('path=/auth');
  });

  it('호출할 때마다 다른 state를 만든다', async () => {
    const a = await startLogin();
    const b = await startLogin();
    expect(a.state).not.toBe(b.state);
  });

  it('GitHub 설정이 없으면 비밀을 노출하지 않고 오류 화면으로 보낸다', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    const res = await startRoute.GET(new Request(`${BASE}/auth/github`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/?auth_error=server_error`);
  });
});

describe('GET /auth/github/callback', () => {
  it('성공하면 사용자와 세션을 저장하고 세션 쿠키를 설정한 뒤 /로 302 리다이렉트한다', async () => {
    const { state, cookie } = await startLogin();
    const fetchMock = mockGithub();

    const res = await callback(`code=good-code&state=${state}`, { oauth_state: cookie.value });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe("/");

    const cookies = setCookies(res);
    expect(cookies.session.value.length).toBeGreaterThanOrEqual(43);
    expect(cookies.session.attrs).toContain('httponly');
    expect(cookies.session.attrs).toContain('samesite=lax');
    expect(cookies.session.attrs).toContain('path=/');
    expect(cookies.session.attrs).not.toContain('secure'); // http 요청이므로
    // state 쿠키는 즉시 만료시킨다
    expect(cookies.oauth_state.attrs).toContain('max-age=0');

    // username, avatar_url이 DB에 저장된다
    expect(await t.db.collection('users').findOne({ githubId: 42 })).toMatchObject({
      username: 'octocat',
      avatarUrl: profile.avatarUrl,
    });
    // 쿠키 토큰으로 로그인 상태가 된다
    expect(await getSessionUser(t.db, cookies.session.value)).toMatchObject({ username: 'octocat' });
    // 액세스 토큰은 DB 어디에도 저장하지 않는다
    for (const name of ['users', 'sessions']) {
      expect(JSON.stringify(await t.db.collection(name).find().toArray())).not.toContain('gho_secret_token');
    }
    // 코드 교환 요청에 code가 전달되었다
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).code).toBe('good-code');
  });

  it('접속 호스트가 localhost가 아니어도(IP·도메인·프록시) 같은 호스트로 돌아가도록 상대 경로로 리다이렉트한다', async () => {
    // 절대 주소를 만들면 Next가 정규화한 내부 호스트(localhost)로 보내져, 접속한 호스트에 저장된 세션 쿠키가 적용되지 않는다.
    const base = 'http://127.0.0.1:3000';
    const { state, cookie } = await startLogin(base);
    mockGithub();
    const ok = await callback(`code=c&state=${state}`, { oauth_state: cookie.value }, base);
    expect(ok.headers.get('location')).toBe('/');

    const denied = await callback(`error=access_denied&state=${state}`, { oauth_state: cookie.value }, base);
    expect(denied.headers.get('location')).toBe('/?auth_error=denied');
    for (const response of [ok, denied]) expect(response.headers.get('location')).not.toMatch(/^https?:/);
  });

  it('https 요청이면 세션 쿠키에 Secure가 붙는다', async () => {
    const base = 'https://todo.example.com';
    const { state, cookie } = await startLogin(base);
    mockGithub();
    const res = await callback(`code=c&state=${state}`, { oauth_state: cookie.value }, base);
    expect(setCookies(res).session.attrs).toContain('secure');
  });

  it('state 쿠키가 없으면 400이고 세션을 만들지 않는다', async () => {
    mockGithub();
    const res = await callback('code=c&state=whatever');
    expect(res.status).toBe(400);
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
    expect(setCookies(res).session).toBeUndefined();
  });

  it('state가 다르거나 없으면 400이고 GitHub를 호출하지 않는다 (CSRF 방지)', async () => {
    const { cookie } = await startLogin();
    const fetchMock = mockGithub();

    expect((await callback('code=c&state=forged', { oauth_state: cookie.value })).status).toBe(400);
    expect((await callback('code=c', { oauth_state: cookie.value })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.db.collection('users').countDocuments()).toBe(0);
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
  });

  it('사용자가 GitHub에서 승인을 거부하면 세션 없이 오류 화면으로 보낸다', async () => {
    const { state, cookie } = await startLogin();
    const res = await callback(`error=access_denied&state=${state}`, { oauth_state: cookie.value });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/?auth_error=denied`);
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
  });

  it('access_denied 외의 GitHub error는 "취소"가 아니라 일반 GitHub 오류로 알린다', async () => {
    const { state, cookie } = await startLogin();
    const res = await callback(`error=redirect_uri_mismatch&state=${state}`, { oauth_state: cookie.value });
    expect(res.headers.get('location')).toBe('/?auth_error=github_failed');
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
  });

  it('code가 없으면 오류 화면으로 보낸다', async () => {
    const { state, cookie } = await startLogin();
    const res = await callback(`state=${state}`, { oauth_state: cookie.value });
    expect(res.headers.get('location')).toBe(`/?auth_error=missing_code`);
  });

  it('GitHub 교환이 실패하면 세션도 사용자도 만들지 않고 secret이나 내부 문구를 노출하지 않는다', async () => {
    const { state, cookie } = await startLogin();
    mockGithub({ token: { error: 'bad_verification_code', error_description: 'internal detail' } });

    const res = await callback(`code=bad&state=${state}`, { oauth_state: cookie.value });
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/?auth_error=github_failed`);
    expect(location).not.toContain('test-client-secret-value');
    expect(location).not.toContain('bad_verification_code');
    expect(await t.db.collection('users').countDocuments()).toBe(0);
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
    expect(setCookies(res).session).toBeUndefined();
  });

  it('서버 설정 오류는 server_error로 알리고 세부 내용을 노출하지 않는다', async () => {
    const { state, cookie } = await startLogin();
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    const res = await callback(`code=c&state=${state}`, { oauth_state: cookie.value });
    expect(res.headers.get('location')).toBe(`/?auth_error=server_error`);
  });

  it('같은 사용자가 다시 로그인하면 사용자 문서는 하나이고 세션만 늘어난다', async () => {
    for (let i = 0; i < 2; i++) {
      const { state, cookie } = await startLogin();
      mockGithub();
      await callback(`code=c&state=${state}`, { oauth_state: cookie.value });
    }
    expect(await t.db.collection('users').countDocuments()).toBe(1);
    expect(await t.db.collection('sessions').countDocuments()).toBe(2);
  });
});

describe('POST /auth/logout', () => {
  async function loggedIn() {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);
    return { user, token };
  }
  const logout = (cookies: Record<string, string>, headers: Record<string, string> = {}) =>
    logoutRoute.POST(new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader(cookies), ...headers } }));

  it('DB에서 세션을 삭제하고 쿠키를 만료시킨다', async () => {
    const { token } = await loggedIn();
    const res = await logout({ session: token });

    expect(res.status).toBe(204);
    expect(await t.db.collection('sessions').countDocuments()).toBe(0);
    const cookie = setCookies(res).session;
    expect(cookie.attrs).toContain('max-age=0');
    expect(cookie.attrs).toContain('path=/');
    expect(await getSessionUser(t.db, token)).toBeNull();
  });

  it('로그아웃한 세션 쿠키를 다시 보내도 /api/me는 401이다 (세션 재사용 불가)', async () => {
    const { token } = await loggedIn();
    await logout({ session: token });
    const res = await meRoute.GET(new Request(`${BASE}/api/me`, { headers: { cookie: cookieHeader({ session: token }) } }));
    expect(res.status).toBe(401);
  });

  it('다른 세션은 유지한다', async () => {
    const a = await loggedIn();
    const b = await createSession(t.db, a.user.id);
    await logout({ session: a.token });
    expect(await getSessionUser(t.db, b.token)).not.toBeNull();
  });

  it('로그인하지 않은 상태에서 호출해도 오류 없이 성공한다 (멱등)', async () => {
    expect((await logout({})).status).toBe(204);
    expect((await logout({ session: 'garbage' })).status).toBe(204);
  });

  it('다른 출처에서 온 요청은 403이고 세션을 지우지 않는다 (CSRF 방지)', async () => {
    const { token } = await loggedIn();
    const res = await logout({ session: token }, { origin: 'https://evil.example', host: 'localhost:3000' });
    expect(res.status).toBe(403);
    expect(await getSessionUser(t.db, token)).not.toBeNull();
  });

  it('프록시 뒤에서 공개 호스트가 x-forwarded-host로 오면 그 호스트와 같은 출처는 허용하고 다른 출처는 막는다', async () => {
    const { token } = await loggedIn();
    const proxied = { host: 'localhost:3000', 'x-forwarded-host': 'todo.example.com' };

    const same = await logout({ session: token }, { ...proxied, origin: 'https://todo.example.com' });
    expect(same.status).toBe(204);

    const { token: token2 } = await loggedIn();
    const evil = await logout({ session: token2 }, { ...proxied, origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(await getSessionUser(t.db, token2)).not.toBeNull();
  });

  it('같은 출처 요청은 허용한다', async () => {
    const { token } = await loggedIn();
    const res = await logout({ session: token }, { origin: 'http://localhost:3000', host: 'localhost:3000' });
    expect(res.status).toBe(204);
  });
});

describe('GET /api/me', () => {
  const me = (cookies: Record<string, string>) =>
    meRoute.GET(new Request(`${BASE}/api/me`, { headers: { cookie: cookieHeader(cookies) } }));

  it('로그인 상태면 id, username, avatarUrl만 돌려준다 (내부 값 제외)', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);
    const res = await me({ session: token });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ id: user.id, username: 'octocat', avatarUrl: profile.avatarUrl });
    expect(JSON.stringify(body)).not.toContain('githubId');
  });

  it('쿠키가 없거나 알 수 없는 토큰이면 401이다', async () => {
    expect((await me({})).status).toBe(401);
    expect((await me({ session: 'not-a-real-token' })).status).toBe(401);
  });

  it('만료된 세션은 401이다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);
    await t.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me({ session: token })).status).toBe(401);
  });
});
