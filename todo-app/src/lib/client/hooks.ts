'use client';

import { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { AuthUser, Goal, Todo, WeekWithProgress } from '../types';
import { ApiError, errorMessage, fetcher, request } from './http';

export const ME_KEY = '/api/me';

/** 로그인한 사용자. 로그인하지 않았으면(401) 오류가 아니라 null을 돌려준다. */
async function fetchMe(): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>('GET', ME_KEY);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export const useMe = () => useSWR<AuthUser | null>(ME_KEY, fetchMe);

export const useGoals = () => useSWR<Goal[]>('/api/goals', fetcher);
export const useWeeks = () => useSWR<WeekWithProgress[]>('/api/weeks', fetcher);

export const todosKey = (weekId: string) => `/api/todos?weekId=${weekId}`;
export const useTodos = (weekId: string | undefined) =>
  useSWR<Todo[]>(weekId ? todosKey(weekId) : null, fetcher);

/** 할 일이 바뀌면 주간 진행률도 달라지므로, 변경 후 관련 캐시를 다시 불러오는 함수들. */
export function useRefresh() {
  const { mutate } = useSWRConfig();
  return {
    goals: useCallback(() => mutate('/api/goals'), [mutate]),
    weeks: useCallback(() => mutate('/api/weeks'), [mutate]),
    todos: useCallback((weekId: string) => mutate(todosKey(weekId)), [mutate]),
    /** 목표·주간 삭제처럼 하위 데이터까지 영향을 주는 변경 뒤에 쓴다. */
    everything: useCallback(
      () => mutate((key) => typeof key === 'string' && key.startsWith('/api/')),
      [mutate],
    ),
  };
}

/** 비동기 동작을 실행하며 진행 상태와 오류 메시지를 관리한다. 성공하면 true를 반환한다. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}
