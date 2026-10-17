import { AppError, unauthorized } from '../errors';
import { getDb } from '../db';
import type { AuthUser } from '../types';
import { cookieValue, SESSION_COOKIE } from './cookies';
import { getSessionUser } from './session';

/** 요청의 세션 쿠키로 로그인한 사용자를 찾는다. 로그인하지 않았으면 null. */
export async function getRequestUser(request: Request): Promise<AuthUser | null> {
  return getSessionUser(await getDb(), cookieValue(request, SESSION_COOKIE));
}

/** 로그인이 필요한 API용. 로그인하지 않았으면 401을 던진다. 클라이언트를 믿지 않고 매 요청마다 서버가 세션을 확인한다. */
export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getRequestUser(request);
  if (!user) throw unauthorized();
  return user;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 상태를 바꾸는 요청(POST/PATCH/DELETE 등)은 Origin이 있으면 요청 호스트와 같아야 한다.
 * SameSite=Lax 쿠키와 함께 쓰는 CSRF 방어다. Origin이 없는 요청(curl 등 브라우저 밖)은 쿠키를 자동으로 싣지 않으므로 통과시킨다.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get('origin');
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, '허용되지 않은 요청 출처입니다');
  }
  // 프록시 뒤에서는 공개 호스트가 x-forwarded-host로 전달된다. 브라우저는 다른 사이트의 요청에 이 헤더를 임의로 실을 수 없으므로
  // 허용 호스트로 인정해도 CSRF 방어가 약해지지 않는다.
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  const allowed = [request.headers.get('host') ?? new URL(request.url).host, forwarded];
  if (!allowed.includes(originHost)) throw new AppError(403, '허용되지 않은 요청 출처입니다');
}
