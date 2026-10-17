import { z } from 'zod';
import { AppError } from '../errors';
import { getGithubConfig } from './config';

const TIMEOUT_MS = 10_000;

/** 오류 메시지에는 GitHub 응답 본문이나 secret을 담지 않는다. 원인은 서버 로그에서만 확인한다. */
const upstreamError = (what: string) => new AppError(502, `GitHub ${what}에 실패했습니다`);

export interface GithubProfile {
  githubId: number;
  username: string;
  avatarUrl: string;
}

/** 사용자를 GitHub 승인 화면으로 보낼 URL. state는 호출자가 만든 CSRF 방지용 일회성 값이다. */
export function authorizeUrl(state: string): string {
  const { clientId, oauthUrl } = getGithubConfig();
  const url = new URL(`${oauthUrl}/login/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

const tokenResponse = z.object({ access_token: z.string().min(1) });

/** 콜백으로 받은 code를 액세스 토큰으로 교환한다. 토큰은 저장하지 않고 호출자가 곧바로 쓰고 버린다. */
export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret, oauthUrl } = getGithubConfig();
  let response: Response;
  try {
    response = await fetch(`${oauthUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[auth] GitHub 토큰 교환 요청 실패:', error instanceof Error ? error.name : 'unknown');
    throw upstreamError('토큰 교환');
  }

  // GitHub는 잘못된 code에도 HTTP 200과 { error } 본문을 돌려준다.
  const body: unknown = await response.json().catch(() => null);
  const parsed = tokenResponse.safeParse(body);
  if (!response.ok || !parsed.success) {
    const reason = (body as { error?: unknown } | null)?.error;
    console.error('[auth] GitHub 토큰 교환 거절:', response.status, typeof reason === 'string' ? reason : 'no access_token');
    throw upstreamError('토큰 교환');
  }
  return parsed.data.access_token;
}

const userResponse = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  // <img src>로 그대로 렌더되므로 http(s) 주소만 받는다 (javascript:, data: 등 차단)
  avatar_url: z.string().regex(/^https?:\/\//i),
});

export async function fetchGithubUser(accessToken: string): Promise<GithubProfile> {
  const { apiUrl } = getGithubConfig();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'todo-app',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[auth] GitHub 사용자 조회 요청 실패:', error instanceof Error ? error.name : 'unknown');
    throw upstreamError('사용자 조회');
  }

  const parsed = userResponse.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    console.error('[auth] GitHub 사용자 조회 거절:', response.status);
    throw upstreamError('사용자 조회');
  }
  const { id, login, avatar_url } = parsed.data;
  return { githubId: id, username: login, avatarUrl: avatar_url };
}
