import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { authorizeUrl } from '@/lib/auth/github';
import { redirectLocal } from '@/lib/auth/redirect';
import { baseCookie, STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_SECONDS } from '@/lib/auth/cookies';

/** GET /auth/github — GitHub 승인 화면으로 보낸다. 돌아올 때 대조할 일회성 state를 쿠키에 남긴다. */
export function GET(request: Request) {
  return handle(async () => {
    const state = randomBytes(24).toString('base64url');

    let target: string;
    try {
      target = authorizeUrl(state);
    } catch (error) {
      // 환경 변수 누락 등 서버 설정 문제. 내용은 서버 로그에만 남기고 사용자에게는 일반 안내만 보인다.
      console.error('[auth] GitHub 로그인을 시작하지 못했습니다:', error instanceof Error ? error.message : error);
      return redirectLocal('/?auth_error=server_error');
    }

    const response = NextResponse.redirect(target, 302);
    response.cookies.set({
      name: STATE_COOKIE,
      value: state,
      ...baseCookie(request),
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    return response;
  });
}
