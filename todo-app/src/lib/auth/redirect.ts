import { NextResponse } from 'next/server';

/**
 * 같은 사이트 안으로의 리다이렉트. Location에 절대 주소를 만들지 않고 상대 경로를 쓴다.
 *
 * Next.js는 request.url의 호스트를 내부 주소(localhost)로 정규화하므로, 그 값으로 절대 주소를 만들면
 * 사용자가 127.0.0.1·IP·도메인·프록시 뒤로 접속했을 때 다른 호스트로 보내진다.
 * 세션 쿠키는 접속한 호스트에 저장되어 있어 그 호스트에서는 쿠키가 적용되지 않고, 로그인이 안 된 것처럼 보인다.
 * 상대 경로는 브라우저가 지금 접속한 호스트 기준으로 해석하므로 항상 쿠키가 있는 곳으로 돌아간다.
 */
export function redirectLocal(path: `/${string}`): NextResponse {
  return new NextResponse(null, { status: 302, headers: { Location: path } });
}
