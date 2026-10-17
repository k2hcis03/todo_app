import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, resetMyData } from './helpers';

// 할 일 관리는 로그인이 필요하다. 인메모리 DB를 모든 테스트가 공유하므로, 로그인한 뒤 내 목표를 모두 지우고 시작한다
// (하위 주간·할 일은 연쇄 삭제된다).
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await loginAs(page, 'alice');
  await resetMyData(page);
});

async function createGoalAndWeek(page: Page) {
  await page.goto('/');
  await page.getByLabel('목표 제목', { exact: true }).fill('건강 관리');
  await page.getByRole('button', { name: '목표 추가' }).click();
  await expect(page.getByRole('button', { name: /건강 관리/ }).first()).toBeVisible();

  await page.getByLabel('주간 계획 제목', { exact: true }).fill('1주차');
  await page.getByRole('button', { name: '주간 추가' }).click();
  await expect(page.getByRole('heading', { name: '1주차 보드' })).toBeVisible();
}

const addForm = (page: Page) => page.getByRole('form', { name: '할 일 추가' });
const editForm = (page: Page) => page.getByRole('form', { name: '할 일 수정' });

async function addTodo(page: Page, title: string, date?: string) {
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  const form = addForm(page);
  await form.getByRole('textbox', { name: '제목' }).fill(title);
  if (date) await form.getByLabel('날짜').fill(date);
  await form.getByRole('button', { name: '추가' }).click();
  await expect(page.getByTestId(`card-${title}`)).toBeVisible();
}

const column = (page: Page, status: 'todo' | 'doing' | 'done') => page.locator(`[data-status="${status}"]`);
const progress = (page: Page, weekTitle: string) => page.getByRole('progressbar', { name: `${weekTitle} 진행률` });

/** dnd-kit의 PointerSensor는 활성화 거리 이상 움직여야 하므로 마우스를 여러 단계로 옮긴다. */
async function dragTo(page: Page, handle: Locator, target: Locator) {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('드래그 대상 좌표를 얻지 못했습니다');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 });
  await page.mouse.up();
}

test('목표 → 주간 → 할 일 → 드래그 → 진행률 → 새로고침 후 유지', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '운동하기');
  await addTodo(page, '물 마시기');
  await addTodo(page, '스트레칭');

  // 새 할 일은 todo 컬럼에 생기고 진행률은 0%다
  await expect(column(page, 'todo').getByTestId('card-운동하기')).toBeVisible();
  await expect(progress(page, '1주차')).toHaveAttribute('aria-valuenow', '0');

  // 3개 중 1개를 done으로 드래그하면 33%
  await dragTo(page, page.getByRole('button', { name: '운동하기 이동' }), column(page, 'done'));
  await expect(column(page, 'done').getByTestId('card-운동하기')).toBeVisible();
  await expect(progress(page, '1주차')).toContainText('33%');

  // doing으로도 옮길 수 있고 진행률은 변하지 않는다
  await dragTo(page, page.getByRole('button', { name: '물 마시기 이동' }), column(page, 'doing'));
  await expect(column(page, 'doing').getByTestId('card-물 마시기')).toBeVisible();
  await expect(progress(page, '1주차')).toContainText('33%');

  // 새로고침해도 상태가 유지된다
  await page.reload();
  await expect(column(page, 'done').getByTestId('card-운동하기')).toBeVisible();
  await expect(column(page, 'doing').getByTestId('card-물 마시기')).toBeVisible();
  await expect(column(page, 'todo').getByTestId('card-스트레칭')).toBeVisible();
  await expect(progress(page, '1주차')).toContainText('33%');
});

test('저장에 실패하면 카드가 원래 컬럼으로 돌아오고 오류가 표시된다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '실패할 이동');

  await page.route('**/api/todos/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '서버 오류가 발생했습니다' }) })
      : route.continue(),
  );

  await dragTo(page, page.getByRole('button', { name: '실패할 이동 이동' }), column(page, 'doing'));

  await expect(page.getByRole('alert').filter({ hasText: '되돌렸습니다' })).toBeVisible();
  await expect(column(page, 'todo').getByTestId('card-실패할 이동')).toBeVisible();
  await expect(column(page, 'doing').getByTestId('card-실패할 이동')).toHaveCount(0);
});

/** 손잡이에 포커스 → Space로 잡기 → 방향키로 이웃 컬럼(진행 중)으로 이동 → Space로 놓기 */
async function moveToDoingByKeyboard(page: Page, title: string, key: 'ArrowRight' | 'ArrowDown' = 'ArrowRight') {
  const announcement = page.locator('[id^="DndLiveRegion"]');

  await page.getByRole('button', { name: `${title} 이동` }).focus();
  await page.keyboard.press('Space');
  await expect(announcement).toContainText('할 일 위에 있습니다'); // 시작 직후 onDragOver 안내가 표시된다

  // dnd-kit은 드래그 시작 직후 setTimeout으로 키 입력 리스너를 붙이므로 첫 방향키가 유실될 수 있다.
  // 안내 문구가 바뀔 때까지, 이미 이동했다면 다시 누르지 않는 멱등한 방식으로 재시도한다.
  await expect(async () => {
    if (!(await announcement.innerText()).includes('진행 중')) await page.keyboard.press(key);
    await expect(announcement).toContainText('진행 중 위에 있습니다', { timeout: 1000 });
  }).toPass();

  await page.keyboard.press('Space');
  await expect(announcement).toContainText('진행 중에 놓았습니다');
}

test('키보드로 카드를 잡고 방향키로 컬럼을 옮길 수 있다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '키보드 이동');

  await moveToDoingByKeyboard(page, '키보드 이동');

  await expect(column(page, 'doing').getByTestId('card-키보드 이동')).toBeVisible();
});

test('좁은 화면(컬럼이 세로로 쌓임)에서는 아래 방향키로 컬럼을 옮길 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createGoalAndWeek(page);
  await addTodo(page, '모바일 키보드');

  await moveToDoingByKeyboard(page, '모바일 키보드', 'ArrowDown');

  await expect(column(page, 'doing').getByTestId('card-모바일 키보드')).toBeVisible();
});

test('상태 선택 상자로도 상태를 바꿀 수 있고 진행률이 갱신된다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '선택으로 변경');
  await page.getByLabel('선택으로 변경 상태 변경').selectOption('done');

  await expect(column(page, 'done').getByTestId('card-선택으로 변경')).toBeVisible();
  await expect(progress(page, '1주차')).toContainText('100%');
});

test('주간 계획을 선택하지 않으면 검증 오류가 보이고, 날짜 필터로 일일 목록을 볼 수 있다', async ({ page }) => {
  await createGoalAndWeek(page);

  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  const form = addForm(page);
  await form.getByRole('textbox', { name: '제목' }).fill('주간 없음');
  await form.getByRole('combobox', { name: /주간 계획/ }).selectOption('');
  await form.getByRole('button', { name: '추가' }).click();
  await expect(form.getByRole('alert')).toHaveText('주간 계획을 선택하세요');
  await form.getByRole('button', { name: '취소' }).click();
  await expect(page.getByTestId('card-주간 없음')).toHaveCount(0);

  // 서로 다른 날짜의 할 일 두 개
  await addTodo(page, '월요일 일', '2026-10-19');
  await addTodo(page, '화요일 일', '2026-10-20');

  await page.getByLabel('날짜 필터').fill('2026-10-20');
  await expect(page.getByTestId('card-화요일 일')).toBeVisible();
  await expect(page.getByTestId('card-월요일 일')).toHaveCount(0);

  await page.getByRole('button', { name: '필터 해제' }).click();
  await expect(page.getByTestId('card-월요일 일')).toBeVisible();
});

test('할 일을 수정하고 삭제하면 진행률 분모가 함께 바뀐다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '고칠 일');
  await addTodo(page, '지울 일');

  await page.getByRole('button', { name: '고칠 일 수정' }).click();
  const form = editForm(page);
  await form.getByRole('textbox', { name: '제목' }).fill('고친 일');
  await form.getByRole('combobox', { name: /상태/ }).selectOption('done');
  await form.getByRole('button', { name: '저장' }).click();
  await expect(column(page, 'done').getByTestId('card-고친 일')).toBeVisible();
  await expect(progress(page, '1주차')).toContainText('50%');

  await page.getByRole('button', { name: '지울 일 삭제' }).click();
  await expect(page.getByTestId('card-지울 일')).toHaveCount(0);
  await expect(progress(page, '1주차')).toContainText('100%');
});

test('목표와 주간 계획을 수정하고, 주간을 바꾸면 보드가 그 주간의 할 일로 바뀐다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '첫 주 할 일');

  // 목표 수정
  await page.getByRole('button', { name: '건강 관리 수정' }).click();
  await page.getByLabel('목표 제목 수정').fill('체력 키우기');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('button', { name: /체력 키우기/ }).first()).toBeVisible();

  // 두 번째 주간 계획을 만들면 그 주간이 선택되어 보드가 비어 있다
  await page.getByLabel('주간 계획 제목', { exact: true }).fill('2주차');
  await page.getByRole('button', { name: '주간 추가' }).click();
  await expect(page.getByRole('heading', { name: '2주차 보드' })).toBeVisible();
  await expect(page.getByTestId('card-첫 주 할 일')).toHaveCount(0);

  // 1주차를 선택하면 1주차의 할 일이 보인다
  await page.getByRole('button', { name: /^1주차 \d{4}-\d{2}-\d{2}/ }).click(); // 수정·삭제 버튼과 구분
  await expect(page.getByRole('heading', { name: '1주차 보드' })).toBeVisible();
  await expect(page.getByTestId('card-첫 주 할 일')).toBeVisible();

  // 주간 계획 수정
  await page.getByRole('button', { name: '1주차 수정' }).click();
  await page.getByLabel('주간 계획 제목 수정').fill('첫째 주');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: '첫째 주 보드' })).toBeVisible();
  await expect(progress(page, '첫째 주')).toBeVisible();
});

test('목표를 삭제하면 주간 계획과 할 일도 사라진다', async ({ page }) => {
  await createGoalAndWeek(page);
  await addTodo(page, '사라질 일');

  await page.getByRole('button', { name: '건강 관리 삭제' }).click();
  await expect(page.getByText('목표를 만들어 시작하세요.')).toBeVisible();
  expect(await (await page.request.get('/api/weeks')).json()).toEqual([]);
  expect(await (await page.request.get('/api/todos')).json()).toEqual([]);
});
