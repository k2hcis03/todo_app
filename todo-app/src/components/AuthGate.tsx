'use client';

import { useCallback, useEffect } from 'react';
import { useSWRConfig } from 'swr';
import { ME_KEY, useMe } from '@/lib/client/hooks';
import { errorMessage, UNAUTHORIZED_EVENT } from '@/lib/client/http';
import { App } from './App';
import { authErrorMessage, LoginScreen } from './LoginScreen';

/**
 * 로그인 여부로 화면을 가른다. 기준은 서버의 /api/me 하나다.
 * 로그인하지 않았으면 할 일 UI를 아예 마운트하지 않으므로 목록 API도 호출하지 않는다.
 */
export function AuthGate() {
  const { data: user, error, isLoading, mutate } = useMe();
  const { mutate: mutateAll } = useSWRConfig();

  /** 화면의 로그인 상태를 정리한다. 캐시를 모두 비워 이전 사용자의 데이터가 다음 사용자에게 보이지 않게 한다. */
  const signOutLocally = useCallback(async () => {
    await mutateAll(() => true, undefined, { revalidate: false });
    await mutateAll(ME_KEY, null, { revalidate: false });
  }, [mutateAll]);

  // 사용 중에 세션이 만료되어 어떤 API든 401을 받으면 로그인 화면으로 전환한다.
  useEffect(() => {
    const onUnauthorized = () => void signOutLocally();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [signOutLocally]);

  if (isLoading) return <p className="empty loading">불러오는 중…</p>;

  if (error) {
    return (
      <main className="login">
        <p className="error" role="alert">
          로그인 상태를 확인하지 못했습니다: {errorMessage(error)}
        </p>
        <button type="button" onClick={() => void mutate()}>
          다시 시도
        </button>
      </main>
    );
  }

  if (!user) {
    const code = new URLSearchParams(window.location.search).get('auth_error');
    return <LoginScreen error={authErrorMessage(code)} />;
  }

  return <App user={user} onSignedOut={signOutLocally} />;
}
