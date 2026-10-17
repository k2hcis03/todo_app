const MESSAGES: Record<string, string> = {
  denied: 'GitHub 로그인이 취소되었습니다. 다시 시도해 주세요',
  missing_code: 'GitHub에서 로그인 정보를 받지 못했습니다. 다시 시도해 주세요',
  github_failed: 'GitHub와 통신하지 못해 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요',
  server_error: '서버 설정 문제로 로그인할 수 없습니다. 관리자에게 문의해 주세요',
};

/**
 * 주소의 auth_error 값을 사용자에게 보여 줄 문구로 바꾼다.
 * 정해진 코드만 해당 문구로 바꾸고, 그 밖의 값은 화면에 그대로 싣지 않고 일반 문구로 대체한다.
 * 객체 기본 속성 이름(__proto__, constructor …)이 들어와도 문구 대신 객체가 반환되어 화면이 깨지지 않도록 자기 속성만 조회한다.
 */
export function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : '로그인하지 못했습니다. 다시 시도해 주세요';
}

export function LoginScreen({ error }: { error: string | null }) {
  return (
    <main className="login">
      <h1>할 일 관리</h1>
      <p>1년 목표를 주간 계획과 일일 할 일로 쪼개서 관리하세요.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {/* 외부(GitHub)로 이동하는 전체 페이지 이동이라 next/link가 아니라 일반 링크를 쓴다. */}
      <a className="button-link" href="/auth/github">
        GitHub로 로그인
      </a>
    </main>
  );
}
