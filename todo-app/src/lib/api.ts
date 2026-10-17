import { connection } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { assertSameOrigin, requireUser } from './auth/request';
import { AppError } from './errors';
import { objectIdString } from './schemas';
import type { AuthUser } from './types';

/**
 * Route Handler 공통 래퍼.
 * - connection(): cacheComponents 모드에서 DB를 쓰는 GET이 빌드 시 정적으로 만들어지지 않도록 요청 시점 실행을 보장한다.
 * - 입력 오류(Zod, 깨진 JSON)는 400, 도메인 오류(AppError)는 해당 상태 코드, 나머지는 내부 정보를 숨기고 500으로 응답한다.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  await connection();
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: '입력값이 올바르지 않습니다',
          issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: '요청 본문이 올바른 JSON이 아닙니다' }, { status: 400 });
    }
    console.error('[api] 처리되지 않은 오류', error);
    return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
  }
}

/**
 * 로그인이 필요한 Route Handler용 래퍼. 순서가 중요하다:
 * 출처 확인(CSRF) → 세션 확인(401) → 그 뒤에야 본문 파싱과 DB 조회를 한다.
 * 클라이언트 화면의 로그인 여부를 믿지 않고 모든 요청에서 서버가 세션을 다시 확인한다.
 */
export async function handleAuthed(request: Request, fn: (user: AuthUser) => Promise<Response>): Promise<Response> {
  const response = await handle(async () => {
    assertSameOrigin(request);
    return fn(await requireUser(request));
  });
  // 사용자별 데이터이므로 오류 응답을 포함해 브라우저·프록시 같은 공유 캐시에 저장되지 않게 한다.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** URL 경로의 id를 검증한다. 형식이 틀리면 ZodError → 400. */
export function parseId(id: string): string {
  return objectIdString.parse(id);
}

/** 선택 쿼리 파라미터를 스키마로 검증해 반환한다. 없거나 비어 있으면 undefined, 형식이 틀리면 ZodError → 400. */
export function optionalQuery<T>(request: Request, name: string, schema: ZodType<T>): T | undefined {
  const value = new URL(request.url).searchParams.get(name);
  return value ? schema.parse(value) : undefined;
}

export type IdContext = { params: Promise<{ id: string }> };
