/** HTTP 상태 코드를 함께 가지는 도메인 오류. Route Handler가 응답으로 변환한다. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = () => new AppError(401, '로그인이 필요합니다');

export const notFound =(what: string) => new AppError(404, `${what} 항목을 찾을 수 없습니다`);
