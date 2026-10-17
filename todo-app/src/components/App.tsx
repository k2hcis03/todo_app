'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/client/http';
import { useGoals, useWeeks } from '@/lib/client/hooks';
import type { AuthUser } from '@/lib/types';
import { Board } from './Board';
import { GoalPanel } from './GoalPanel';
import { UserBar } from './UserBar';
import { WeekPanel } from './WeekPanel';

interface Props {
  user: AuthUser;
  onSignedOut: () => Promise<void>;
}

export function App({ user, onSignedOut }: Props) {
  const goals = useGoals();
  const weeks = useWeeks();
  const [pickedGoalId, setPickedGoalId] = useState<string>();
  const [pickedWeekId, setPickedWeekId] = useState<string>();

  const goalList = goals.data ?? [];
  const allWeeks = weeks.data ?? [];

  // 사용자가 고른 항목이 삭제되었거나 아직 없으면 첫 번째 항목을 기본 선택한다.
  const activeGoalId = goalList.some((g) => g.id === pickedGoalId) ? pickedGoalId : goalList[0]?.id;
  const goalWeeks = allWeeks.filter((w) => w.goalId === activeGoalId);
  const activeWeekId = goalWeeks.some((w) => w.id === pickedWeekId) ? pickedWeekId : goalWeeks[0]?.id;

  const loadError = goals.error ?? weeks.error;

  return (
    <div className="shell">
      <header className="app-header">
        <div>
          <h1>할 일 관리</h1>
          <p>1년 목표 → 주간 계획 → 오늘의 할 일</p>
        </div>
        <UserBar user={user} onSignedOut={onSignedOut} />
      </header>

      {loadError && (
        <p className="error" role="alert">데이터를 불러오지 못했습니다: {errorMessage(loadError)}</p>
      )}

      <div className="layout">
        <aside className="side">
          <GoalPanel goals={goalList} activeId={activeGoalId} onSelect={setPickedGoalId} />
          <WeekPanel goalId={activeGoalId} weeks={goalWeeks} activeId={activeWeekId} onSelect={setPickedWeekId} />
        </aside>
        <main>
          {/* 주간이 바뀌면 열려 있던 폼, 날짜 필터, 오류 표시를 초기화하려고 key로 보드를 새로 만든다. */}
          <Board key={activeWeekId ?? 'none'} weekId={activeWeekId} goals={goalList} weeks={allWeeks} />
        </main>
      </div>
    </div>
  );
}
