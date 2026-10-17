import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, exchangeCode, fetchGithubUser } from '@/lib/auth/github';
import { createSession, deleteSession, getSessionUser, SESSION_TTL_MS } from '@/lib/auth/session';
import { upsertGithubUser } from '@/lib/auth/users';
import { startTestDb, type TestDb } from './test-db';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.stop();
});
beforeEach(async () => {
  await t.reset();
  await t.db.collection('users').deleteMany({});
  await t.db.collection('sessions').deleteMany({});
  vi.stubEnv('GITHUB_CLIENT_ID', 'test-client-id');
  vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-client-secret-value');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const profile = { githubId: 1234, username: 'octocat', avatarUrl: 'https://avatars.example/octocat.png' };

describe('users', () => {
  it('GitHub username과 avatar_url을 DB에 저장한다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    expect(user).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/), username: 'octocat', avatarUrl: profile.avatarUrl });

    const stored = await t.db.collection('users').findOne({ githubId: 1234 });
    expect(stored).toMatchObject({ username: 'octocat', avatarUrl: profile.avatarUrl, githubId: 1234 });
  });

  it('같은 사용자가 다시 로그인하면 새 문서를 만들지 않고 username/avatarUrl만 갱신한다', async () => {
    const first = await upsertGithubUser(t.db, profile);
    const second = await upsertGithubUser(t.db, { ...profile, username: 'renamed', avatarUrl: 'https://avatars.example/new.png' });

    expect(second.id).toBe(first.id);
    expect(await t.db.collection('users').countDocuments()).toBe(1);
    expect(second).toMatchObject({ username: 'renamed', avatarUrl: 'https://avatars.example/new.png' });
  });

  it('githubId가 다르면 다른 사용자다', async () => {
    const a = await upsertGithubUser(t.db, profile);
    const b = await upsertGithubUser(t.db, { ...profile, githubId: 999, username: 'other' });
    expect(a.id).not.toBe(b.id);
  });

  it('githubId는 고유 인덱스로 보호된다 (동시 첫 로그인 중복 방지)', async () => {
    await expect(
      Promise.all([upsertGithubUser(t.db, profile), upsertGithubUser(t.db, profile)]),
    ).resolves.toHaveLength(2);
    expect(await t.db.collection('users').countDocuments({ githubId: 1234 })).toBe(1);
  });
});

describe('sessions', () => {
  it('원본 토큰은 DB에 저장하지 않고 SHA-256 해시만 저장한다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);

    const docs = await t.db.collection('sessions').find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(docs[0])).not.toContain(token);
  });

  it('토큰은 충분히 길고 호출마다 다르다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const a = await createSession(t.db, user.id);
    const b = await createSession(t.db, user.id);
    expect(a.token.length).toBeGreaterThanOrEqual(43); // 32바이트 base64url
    expect(a.token).not.toBe(b.token);
  });

  it('유효한 세션은 사용자 정보를 돌려주고 만료는 7일이다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const before = Date.now();
    const { token, expiresAt } = await createSession(t.db, user.id);

    expect(await getSessionUser(t.db, token)).toEqual(user);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(SESSION_TTL_MS - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(SESSION_TTL_MS + 5000);
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('없는 토큰·빈 토큰은 null이다', async () => {
    expect(await getSessionUser(t.db, 'nope')).toBeNull();
    expect(await getSessionUser(t.db, '')).toBeNull();
    expect(await getSessionUser(t.db, undefined)).toBeNull();
  });

  it('만료된 세션은 TTL 인덱스가 지우기 전이라도 null이다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);
    await t.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getSessionUser(t.db, token)).toBeNull();
  });

  it('삭제하면 DB에서 문서가 사라지고 이후 조회는 null이다 (다른 세션은 유지)', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const a = await createSession(t.db, user.id);
    const b = await createSession(t.db, user.id);

    await deleteSession(t.db, a.token);
    expect(await t.db.collection('sessions').countDocuments()).toBe(1);
    expect(await getSessionUser(t.db, a.token)).toBeNull();
    expect(await getSessionUser(t.db, b.token)).toEqual(user);
  });

  it('사용자가 사라진 세션은 null이다', async () => {
    const user = await upsertGithubUser(t.db, profile);
    const { token } = await createSession(t.db, user.id);
    await t.db.collection('users').deleteMany({});
    expect(await getSessionUser(t.db, token)).toBeNull();
  });

  it('tokenHash는 고유하고 expiresAt에 TTL 인덱스가 있다', async () => {
    const indexes = await t.db.collection('sessions').indexes();
    expect(indexes.find((i) => i.key.tokenHash)?.unique).toBe(true);
    expect(indexes.find((i) => i.key.expiresAt)?.expireAfterSeconds).toBe(0);
    const userIndexes = await t.db.collection('users').indexes();
    expect(userIndexes.find((i) => i.key.githubId)?.unique).toBe(true);
  });
});

describe('GitHub 클라이언트', () => {
  const mockFetch = (...responses: Array<{ status?: number; body: unknown }>) => {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } }));
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('authorize URL에 client_id, state, scope가 들어가고 secret은 들어가지 않는다', () => {
    const url = new URL(authorizeUrl('state-abc'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('scope')).toBe('read:user');
    expect(url.toString()).not.toContain('test-client-secret-value');
  });

  it('GITHUB_OAUTH_URL로 기준 주소를 바꿀 수 있다 (테스트용 가짜 서버)', () => {
    vi.stubEnv('GITHUB_OAUTH_URL', 'http://127.0.0.1:4010');
    expect(authorizeUrl('s').startsWith('http://127.0.0.1:4010/login/oauth/authorize?')).toBe(true);
  });

  it('환경 변수가 없으면 명확한 오류를 던진다', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    expect(() => authorizeUrl('s')).toThrow(/GITHUB_CLIENT_ID/);
    vi.stubEnv('GITHUB_CLIENT_ID', 'x');
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    expect(() => authorizeUrl('s')).toThrow(/GITHUB_CLIENT_SECRET/);
  });

  it('코드를 액세스 토큰으로 교환한다', async () => {
    const fetchMock = mockFetch({ body: { access_token: 'gho_token', token_type: 'bearer' } });
    expect(await exchangeCode('the-code')).toBe('gho_token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(init.headers.Accept).toBe('application/json');
    // 요청 본문의 secret은 코드에 박힌 값이 아니라 환경 변수에서 읽은 값이어야 한다
    expect(JSON.parse(init.body)).toEqual({
      client_id: 'test-client-id',
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: 'the-code',
    });
  });

  it('GitHub가 200으로 error를 돌려줘도 실패 처리하고 secret/내부 문구를 오류에 담지 않는다', async () => {
    mockFetch({ body: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });
    const error = await exchangeCode('bad').catch((e) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(String(error.message)).not.toContain('test-client-secret-value');
    expect(String(error.message)).not.toContain('bad_verification_code');
  });

  it('HTTP 오류나 access_token이 없는 응답도 실패 처리한다', async () => {
    mockFetch({ status: 500, body: { message: 'boom' } }, { body: {} });
    await expect(exchangeCode('c1')).rejects.toMatchObject({ status: 502 });
    await expect(exchangeCode('c2')).rejects.toMatchObject({ status: 502 });
  });

  it('네트워크 오류도 secret 없이 실패 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED with test-client-secret-value')));
    const error = await exchangeCode('c').catch((e) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(String(error.message)).not.toContain('test-client-secret-value');
  });

  it('사용자 정보를 조회해 id, login, avatar_url을 돌려준다', async () => {
    const fetchMock = mockFetch({ body: { id: 1234, login: 'octocat', avatar_url: 'https://avatars.example/o.png', email: 'private@example.com' } });
    expect(await fetchGithubUser('gho_token')).toEqual({ githubId: 1234, username: 'octocat', avatarUrl: 'https://avatars.example/o.png' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/user');
    expect(init.headers.Authorization).toBe('Bearer gho_token');
    expect(init.headers['User-Agent']).toBeTruthy();
  });

  it('avatar_url이 http(s) 주소가 아니면(javascript: 등) 실패 처리한다', async () => {
    mockFetch(
      { body: { id: 1, login: 'x', avatar_url: 'javascript:alert(1)' } },
      { body: { id: 1, login: 'x', avatar_url: 'data:text/html,<script>1</script>' } },
    );
    await expect(fetchGithubUser('t')).rejects.toMatchObject({ status: 502 });
    await expect(fetchGithubUser('t')).rejects.toMatchObject({ status: 502 });
  });

  it('형식이 틀린 사용자 응답은 실패 처리한다', async () => {
    mockFetch({ body: { id: 'not-a-number', login: 'x' } }, { status: 401, body: { message: 'Bad credentials' } });
    await expect(fetchGithubUser('t')).rejects.toMatchObject({ status: 502 });
    await expect(fetchGithubUser('t')).rejects.toMatchObject({ status: 502 });
  });
});
