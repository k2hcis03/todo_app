// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/components/AuthGate';

const user = { id: 'u1', username: 'octocat', avatarUrl: 'https://avatars.example/octocat.png' };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** URL·메서드별로 응답을 정해 fetch를 대체한다. 호출 기록으로 "어떤 요청이 나갔는지"를 검증한다. */
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key] ?? routes[url.split('?')[0]];
    if (!handler) return Response.json({ error: `unmocked ${key}` }, { status: 500 });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const unauthorized = () => json({ error: '로그인이 필요합니다' }, 401);
const calledUrls = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.map(([input]) => String(input));

function renderGate() {
  // 캐시 Map을 직접 들고 있어 로그아웃 뒤 캐시가 비워졌는지 확인할 수 있다.
  const cache = new Map<string, { data?: unknown }>();
  render(
    <SWRConfig value={{ provider: () => cache as never, dedupingInterval: 0, shouldRetryOnError: false }}>
      <AuthGate />
    </SWRConfig>,
  );
  return { cache };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('로그인하지 않았을 때', () => {
  it('"GitHub로 로그인" 링크(/auth/github)가 있는 로그인 화면만 보여 준다', async () => {
    mockApi({ '/api/me': unauthorized });
    renderGate();

    const link = await screen.findByRole('link', { name: 'GitHub로 로그인' });
    expect(link).toHaveAttribute('href', '/auth/github');
    expect(screen.queryByText('1년 목표')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('할 일 UI를 그리지 않으므로 목표·주간·할 일 API를 호출하지도 않는다', async () => {
    const fetchMock = mockApi({ '/api/me': unauthorized });
    renderGate();
    await screen.findByRole('link', { name: 'GitHub로 로그인' });

    const urls = calledUrls(fetchMock);
    expect(urls).toEqual(['/api/me']);
  });

  it.each([
    ['denied', /취소/],
    ['missing_code', /다시 시도/],
    ['github_failed', /GitHub/],
    ['server_error', /설정|관리자/],
  ])('?auth_error=%s 이면 로그인 실패 안내를 보여 준다', async (code, message) => {
    window.history.replaceState({}, '', `/?auth_error=${code}`);
    mockApi({ '/api/me': unauthorized });
    renderGate();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('알 수 없는 auth_error 값도 일반 안내를 보여 주고 값을 그대로 출력하지 않는다', async () => {
    window.history.replaceState({}, '', '/?auth_error=%3Cb%3Eevil%3C%2Fb%3E');
    mockApi({ '/api/me': unauthorized });
    renderGate();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('로그인하지 못했습니다');
    expect(alert).not.toHaveTextContent('evil');
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    '?auth_error=%s 처럼 객체 기본 속성 이름이어도 화면이 깨지지 않고 일반 안내를 보여 준다',
    async (code) => {
      window.history.replaceState({}, '', `/?auth_error=${code}`);
      mockApi({ '/api/me': unauthorized });
      renderGate();

      expect(await screen.findByRole('alert')).toHaveTextContent('로그인하지 못했습니다');
      expect(screen.getByRole('link', { name: 'GitHub로 로그인' })).toBeInTheDocument();
    },
  );

  it('오류가 없으면 안내 문구를 보여 주지 않는다', async () => {
    mockApi({ '/api/me': unauthorized });
    renderGate();
    await screen.findByRole('link', { name: 'GitHub로 로그인' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('로그인했을 때', () => {
  const loggedInApi = (extra: Record<string, Handler> = {}) =>
    mockApi({ '/api/me': () => json(user), '/api/goals': () => json([]), '/api/weeks': () => json([]), ...extra });

  it('헤더에 아바타, GitHub 사용자명, 로그아웃 버튼이 보이고 로그인 링크는 없다', async () => {
    loggedInApi();
    renderGate();

    expect(await screen.findByText('octocat')).toBeInTheDocument();
    const avatar = screen.getByRole('img', { name: 'octocat 프로필 사진' });
    expect(avatar).toHaveAttribute('src', user.avatarUrl);
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GitHub로 로그인' })).not.toBeInTheDocument();
    expect(await screen.findByText('1년 목표')).toBeInTheDocument();
  });

  it('로그아웃하면 POST /auth/logout을 호출하고 로그인 화면으로 돌아가며 이전 데이터를 지운다', async () => {
    let loggedIn = true;
    const fetchMock = loggedInApi({
      '/api/me': () => (loggedIn ? json(user) : unauthorized()),
      '/api/goals': () => json([{ id: 'g1', title: '비밀 목표', year: 2026, createdAt: '', updatedAt: '' }]),
      'POST /auth/logout': () => {
        loggedIn = false;
        return new Response(null, { status: 204 });
      },
    });
    const { cache } = renderGate();
    expect(await screen.findByText('비밀 목표')).toBeInTheDocument();
    expect(cache.get('/api/goals')?.data).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }));

    expect(await screen.findByRole('link', { name: 'GitHub로 로그인' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/auth/logout' && init?.method === 'POST')).toBe(true);
    expect(screen.queryByText('비밀 목표')).not.toBeInTheDocument();
    expect(screen.queryByText('octocat')).not.toBeInTheDocument();
    // 같은 브라우저에서 다음 사람이 로그인해도 이전 사용자의 데이터가 비치지 않도록 캐시가 비워져야 한다
    expect(cache.get('/api/goals')?.data).toBeUndefined();
    expect(cache.get('/api/weeks')?.data).toBeUndefined();
    expect(cache.get('/api/me')?.data).toBeNull();
  });

  it('로그아웃 요청이 실패해도 오류를 알리고 화면은 로그인 상태로 둔다', async () => {
    loggedInApi({ 'POST /auth/logout': () => json({ error: '서버 오류가 발생했습니다' }, 500) });
    renderGate();
    await screen.findByText('octocat');

    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('로그아웃하지 못했습니다');
    expect(screen.getByText('octocat')).toBeInTheDocument();
  });

  it('사용 중에 어떤 API가 401을 돌려주면(세션 만료) 로그인 화면으로 전환한다', async () => {
    let expired = false;
    loggedInApi({
      '/api/me': () => (expired ? unauthorized() : json(user)),
      '/api/goals': () => {
        expired = true;
        return unauthorized();
      },
    });
    renderGate();

    expect(await screen.findByRole('link', { name: 'GitHub로 로그인' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('octocat')).not.toBeInTheDocument());
  });
});

describe('/api/me 확인 중', () => {
  it('응답을 기다리는 동안에는 로그인 링크도 앱도 아닌 불러오는 중 표시를 보여 준다', async () => {
    let release: (r: Response) => void = () => {};
    mockApi({ '/api/me': () => new Promise<Response>((resolve) => (release = resolve)) });
    renderGate();

    expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GitHub로 로그인' })).not.toBeInTheDocument();
    release(unauthorized());
    expect(await screen.findByRole('link', { name: 'GitHub로 로그인' })).toBeInTheDocument();
  });

  it('/api/me가 서버 오류(500)면 로그인 화면이 아니라 오류를 알린다', async () => {
    mockApi({ '/api/me': () => json({ error: '서버 오류가 발생했습니다' }, 500) });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류');
    expect(screen.queryByRole('link', { name: 'GitHub로 로그인' })).not.toBeInTheDocument();
  });
});
