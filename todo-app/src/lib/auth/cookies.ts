export const SESSION_COOKIE = 'session';
/** GitHub로 보내기 전에 만든 일회성 state를 콜백에서 대조하려고 잠시 보관하는 쿠키 */
export const STATE_COOKIE = 'oauth_state';
/** state 쿠키는 인증 경로에만 전송한다 (삭제할 때도 같은 path를 써야 한다). */
export const STATE_COOKIE_PATH = '/auth';
export const STATE_TTL_SECONDS = 10 * 60;

/** Cookie 헤더에서 값 하나를 읽는다. 없으면 undefined. */
export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** https로 접속했으면 쿠키에 Secure를 붙인다. 로컬 http 개발에서는 붙이지 않아야 브라우저가 저장한다. */
export function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

/** 인증 쿠키 공통 속성: JS에서 읽을 수 없고(httpOnly), 다른 사이트의 요청에는 실리지 않는다(lax). */
export function baseCookie(request: Request) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: isHttps(request) };
}
