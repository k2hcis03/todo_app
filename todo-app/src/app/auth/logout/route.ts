import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { baseCookie, cookieValue, SESSION_COOKIE } from '@/lib/auth/cookies';
import { assertSameOrigin } from '@/lib/auth/request';
import { deleteSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';

/** POST /auth/logout — DB의 세션 문서를 지우고 쿠키를 만료시킨다. 로그인하지 않은 상태에서 호출해도 성공한다. */
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await deleteSession(await getDb(), cookieValue(request, SESSION_COOKIE));

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set({ name: SESSION_COOKIE, value: '', ...baseCookie(request), path: '/', maxAge: 0 });
    return response;
  });
}
