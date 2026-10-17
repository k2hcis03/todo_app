import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { baseCookie, cookieValue, SESSION_COOKIE, STATE_COOKIE, STATE_COOKIE_PATH } from '@/lib/auth/cookies';
import { exchangeCode, fetchGithubUser } from '@/lib/auth/github';
import { redirectLocal } from '@/lib/auth/redirect';
import { createSession } from '@/lib/auth/session';
import { upsertGithubUser } from '@/lib/auth/users';
import { getDb } from '@/lib/db';
import { AppError } from '@/lib/errors';

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** state 쿠키는 한 번 쓰면 바로 만료시킨다. */
function clearState(request: Request, response: NextResponse): NextResponse {
  response.cookies.set({ name: STATE_COOKIE, value: '', ...baseCookie(request), path: STATE_COOKIE_PATH, maxAge: 0 });
  return response;
}

/** 실패 사유는 정해진 코드로만 알린다. GitHub 응답이나 내부 오류 문구는 화면 주소에 싣지 않는다. */
function failure(request: Request, code: 'denied' | 'missing_code' | 'github_failed' | 'server_error'): NextResponse {
  return clearState(request, redirectLocal(`/?auth_error=${code}`));
}

/** GET /auth/github/callback — GitHub가 돌려보낸 code를 로그인 세션으로 바꾼다. */
export function GET(request: Request) {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const state = params.get('state');
    const expected = cookieValue(request, STATE_COOKIE);

    // 시작한 브라우저가 맞는지 확인한다. 다르면 GitHub를 호출하지 않고 세션도 만들지 않는다.
    if (!state || !expected || !sameValue(state, expected)) {
      return clearState(request, NextResponse.json({ error: '로그인 요청이 유효하지 않습니다. 다시 시도해 주세요' }, { status: 400 }));
    }
    // 사용자가 직접 거부한 경우만 "취소"로 알리고, 앱 설정 오류(redirect_uri_mismatch 등)는 일반 GitHub 오류로 알린다.
    const githubError = params.get('error');
    if (githubError) return failure(request, githubError === 'access_denied' ? 'denied' : 'github_failed');
    const code = params.get('code');
    if (!code) return failure(request, 'missing_code');

    try {
      const profile = await fetchGithubUser(await exchangeCode(code));
      const db = await getDb();
      const user = await upsertGithubUser(db, profile);
      const { token, expiresAt } = await createSession(db, user.id);

      const response = clearState(request, redirectLocal('/'));
      response.cookies.set({ name: SESSION_COOKIE, value: token, ...baseCookie(request), path: '/', expires: expiresAt });
      return response;
    } catch (error) {
      if (error instanceof AppError) return failure(request, 'github_failed');
      console.error('[auth] 로그인 처리 중 오류:', error instanceof Error ? error.message : error);
      return failure(request, 'server_error');
    }
  });
}
