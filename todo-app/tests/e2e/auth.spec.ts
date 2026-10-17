import { expect, test, type Page } from '@playwright/test';
import { FAKE_GITHUB, loginAs, logout, resetMyData, setFakeGithubUser } from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

/** 목표 하나를 UI로 만들고 그 id를 돌려준다. */
async function createGoal(page: Page, title: string): Promise<string> {
  await page.getByLabel('목표 제목', { exact: true }).fill(title);
  await page.getByRole('button', { name: '목표 추가' }).click();
  await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible();
  const goals: Array<{ id: string; title: string }> = await (await page.request.get('/api/goals')).json();
  return goals.find((g) => g.title === title)!.id;
}

const sessionCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'session');

test('로그인하지 않으면 로그인 화면만 보이고 API는 401이다', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'GitHub로 로그인' })).toHaveAttribute('href', '/auth/github');
  await expect(page.getByRole('heading', { name: '1년 목표' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toHaveCount(0);

  // 화면을 거치지 않고 직접 호출해도 막힌다
  for (const path of ['/api/goals', '/api/weeks', '/api/todos', '/api/me']) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(401);
  }
  expect((await page.request.post('/api/goals', { data: { title: 'x', year: 2026 } })).status()).toBe(401);
});

test('GitHub로 로그인하면 사용자명과 아바타가 보이고 세션 쿠키는 httpOnly이다', async ({ page }) => {
  await loginAs(page, 'alice');

  await expect(page.getByRole('img', { name: 'alice 프로필 사진' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1년 목표' })).toBeVisible();

  const cookie = await sessionCookie(page);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  // 자바스크립트로는 세션 토큰을 읽을 수 없다
  expect(await page.evaluate(() => document.cookie)).not.toContain('session=');
  // 일회성 state 쿠키는 로그인이 끝나면 남지 않는다
  expect((await page.context().cookies()).find((c) => c.name === 'oauth_state')).toBeUndefined();
});

test('새로고침해도 로그인 상태가 유지된다', async ({ page }) => {
  await loginAs(page, 'alice');
  await page.reload();
  await expect(page.getByText('alice', { exact: true })).toBeVisible();
});

test('로그아웃하면 세션이 서버에서 삭제되어 이전 쿠키로도 접근할 수 없다', async ({ page, playwright }) => {
  await loginAs(page, 'alice');
  await resetMyData(page);
  await createGoal(page, '로그아웃 전 목표');
  const oldToken = (await sessionCookie(page))!.value;

  await logout(page);

  // 브라우저의 쿠키는 사라지고
  expect(await sessionCookie(page)).toBeUndefined();
  expect((await page.request.get('/api/goals')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('link', { name: 'GitHub로 로그인' })).toBeVisible();
  await expect(page.getByText('로그아웃 전 목표')).toHaveCount(0);

  // 이전 토큰을 직접 다시 보내도 서버가 거부한다 (세션 완전 삭제)
  const replay = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  expect((await replay.get('/api/me', { headers: { cookie: `session=${oldToken}` } })).status()).toBe(401);
  expect((await replay.get('/api/goals', { headers: { cookie: `session=${oldToken}` } })).status()).toBe(401);
  await replay.dispose();
});

test('두 사용자는 서로의 데이터를 볼 수도, 바꿀 수도 없다', async ({ page }) => {
  // alice가 데이터를 만든다
  await loginAs(page, 'alice');
  await resetMyData(page);
  const aliceGoalId = await createGoal(page, 'alice의 목표');
  await logout(page);

  // bob은 로그인해도 alice의 목표가 보이지 않는다
  await loginAs(page, 'bob');
  await resetMyData(page);
  await expect(page.getByText('alice의 목표')).toHaveCount(0);
  await expect(page.getByText('목표를 만들어 시작하세요.')).toBeVisible();

  // id를 알고 직접 접근해도 404이고, 바꾸거나 지울 수 없다
  expect((await page.request.get(`/api/goals/${aliceGoalId}`)).status()).toBe(404);
  expect((await page.request.patch(`/api/goals/${aliceGoalId}`, { data: { title: '탈취' } })).status()).toBe(404);
  expect((await page.request.delete(`/api/goals/${aliceGoalId}`)).status()).toBe(404);
  const bobWeek = await page.request.post('/api/weeks', { data: { title: 'x', weekStart: '2026-10-19', goalId: aliceGoalId } });
  expect(bobWeek.status()).toBe(404);

  await createGoal(page, 'bob의 목표');
  await logout(page);

  // alice로 돌아오면 자기 데이터만 그대로 있다
  await loginAs(page, 'alice');
  await expect(page.getByRole('button', { name: /alice의 목표/ }).first()).toBeVisible();
  await expect(page.getByText('bob의 목표')).toHaveCount(0);
  const goals: Array<{ title: string }> = await (await page.request.get('/api/goals')).json();
  expect(goals.map((g) => g.title)).toEqual(['alice의 목표']);
});

test('state가 맞지 않는 콜백 요청은 거부되고 로그인되지 않는다 (CSRF 방지)', async ({ page }) => {
  const res = await page.request.get('/auth/github/callback?code=forged&state=forged', { maxRedirects: 0 });
  expect(res.status()).toBe(400);
  expect(res.headers()['set-cookie'] ?? '').not.toContain('session=');

  await page.goto('/auth/github/callback?code=forged&state=forged');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'GitHub로 로그인' })).toBeVisible();
  expect(await sessionCookie(page)).toBeUndefined();
});

test('GitHub에서 승인을 거부하면 안내 문구와 함께 로그인 화면으로 돌아온다', async ({ page }) => {
  await setFakeGithubUser(page, 'alice', { deny: true });
  await page.goto('/');
  await page.getByRole('link', { name: 'GitHub로 로그인' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '취소' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub로 로그인' })).toBeVisible();
  expect(await sessionCookie(page)).toBeUndefined();
});

test('다른 사이트에서 보낸 것처럼 Origin이 다른 변경 요청은 로그인 상태여도 거부된다', async ({ page }) => {
  await loginAs(page, 'alice');
  const res = await page.request.post('/api/goals', {
    data: { title: '위조 요청', year: 2026 },
    headers: { origin: 'https://evil.example' },
  });
  expect(res.status()).toBe(403);
  const goals: Array<{ title: string }> = await (await page.request.get('/api/goals')).json();
  expect(goals.map((g) => g.title)).not.toContain('위조 요청');
});

test('가짜 GitHub 서버는 등록되지 않은 client_id를 거부한다 (테스트 환경 점검)', async ({ page }) => {
  const res = await page.request.get(`${FAKE_GITHUB}/login/oauth/authorize?client_id=wrong&state=x`, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});
