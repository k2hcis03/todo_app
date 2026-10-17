export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  /** authorize·토큰 교환 기준 주소. 테스트에서 가짜 GitHub 서버로 바꿀 수 있다. */
  oauthUrl: string;
  /** 사용자 조회 API 기준 주소 */
  apiUrl: string;
}

/**
 * GitHub OAuth 설정. CLIENT_SECRET은 환경 변수에서만 읽으며 소스에 값을 두지 않는다.
 * 필요한 시점(요청 처리 중)에 읽으므로 환경 변수가 없어도 빌드는 성공한다.
 */
export function getGithubConfig(): GithubConfig {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId) throw new Error('GITHUB_CLIENT_ID 환경 변수가 필요합니다 (.env.example 참고)');
  if (!clientSecret) throw new Error('GITHUB_CLIENT_SECRET 환경 변수가 필요합니다 (.env.example 참고)');

  return {
    clientId,
    clientSecret,
    oauthUrl: (process.env.GITHUB_OAUTH_URL || 'https://github.com').replace(/\/$/, ''),
    apiUrl: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
  };
}
