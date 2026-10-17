'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const subscribe = () => () => {};

/**
 * 서버(사전 렌더링)에서는 fallback만 그리고 브라우저에서만 children을 그린다.
 * 현재 시각(new Date())을 렌더 중에 쓰는 화면이 cacheComponents 사전 렌더링과 충돌하지 않게 한다.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  return isClient ? children : fallback;
}
