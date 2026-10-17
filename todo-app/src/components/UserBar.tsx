'use client';

import { useAction } from '@/lib/client/hooks';
import { request } from '@/lib/client/http';
import type { AuthUser } from '@/lib/types';

interface Props {
  user: AuthUser;
  /** 서버 세션을 지운 뒤 화면의 로그인 상태를 정리한다 */
  onSignedOut: () => Promise<void>;
}

export function UserBar({ user, onSignedOut }: Props) {
  const logout = useAction();

  async function signOut() {
    // 서버가 세션을 지웠다고 확인한 뒤에만 화면을 로그아웃 상태로 바꾼다.
    const ok = await logout.run(() => request('POST', '/auth/logout'));
    if (ok) await onSignedOut();
  }

  return (
    <div className="user-bar">
      {/* GitHub 아바타는 외부 주소이고 크기가 작아 next/image 최적화를 쓰지 않는다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="avatar" src={user.avatarUrl} alt={`${user.username} 프로필 사진`} width={32} height={32} referrerPolicy="no-referrer" />
      <span className="user-name">{user.username}</span>
      <button type="button" className="ghost" onClick={signOut} disabled={logout.pending}>
        로그아웃
      </button>
      {logout.error && (
        <p className="error" role="alert">
          로그아웃하지 못했습니다: {logout.error}
        </p>
      )}
    </div>
  );
}
