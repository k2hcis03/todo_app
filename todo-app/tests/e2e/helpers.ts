import { expect, type Page } from '@playwright/test';

/** 가짜 GitHub 서버 (scripts/fake-github.mjs) */
export const FAKE_GITHUB = `http://127.0.0.1:${process.env.E2E_GITHUB_PORT ?? '4010'}`;

/** 다음 GitHub 로그인에서 어떤 사용자로 승인할지(또는 거부할지) 정한다. */
export async function setFakeGithubUser(page: Page, login: string, options: { deny?: boolean } = {}) {
  const res = await page.request.post(`${FAKE_GITHUB}/__login_as`, { data: { login, deny: options.deny ?? false } });
  expect(res.status()).toBe(204);
}

/** 실제 로그인 흐름(링크 클릭 → GitHub → 콜백 → 세션 쿠키)을 브라우저로 끝까지 수행한다. */
export async function loginAs(page: Page, login: string) {
  await setFakeGithubUser(page, login);
  await page.goto('/');
  await page.getByRole('link', { name: 'GitHub로 로그인' }).click();
  await expect(page.getByText(login, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('link', { name: 'GitHub로 로그인' })).toBeVisible();
}

/** 로그인한 사용자의 목표를 모두 지운다 (하위 주간·할 일은 연쇄 삭제). page.request는 페이지와 쿠키를 공유한다. */
export async function resetMyData(page: Page) {
  const goals: Array<{ id: string }> = await (await page.request.get('/api/goals')).json();
  for (const goal of goals) await page.request.delete(`/api/goals/${goal.id}`);
  // 로그인 직후 화면이 지우기 전 데이터를 이미 그렸을 수 있으므로 다시 불러와 화면을 서버 상태에 맞춘다.
  if (goals.length > 0) await page.reload();
}
