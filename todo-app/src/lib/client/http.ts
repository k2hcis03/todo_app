export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 어떤 API가 401을 돌려주면 발생한다. 세션이 만료되었을 때 화면을 로그인 상태에서 벗어나게 하는 신호다. */
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

interface ErrorBody {
  error?: string;
  issues?: Array<{ path: string; message: string }>;
}

/** JSON API 호출. 실패하면 서버가 준 한국어 메시지를 담은 ApiError를 던진다. */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const { error, issues } = (data ?? {}) as ErrorBody;
    throw new ApiError(issues?.[0]?.message ?? error ?? '요청에 실패했습니다', response.status);
  }
  return data as T;
}

export const fetcher = <T>(url: string) => request<T>('GET', url);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다';
}
