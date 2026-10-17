'use client';

import { useState, type SyntheticEvent } from 'react';
import { mondayOf, todayString } from '@/lib/dates';
import { useAction, useRefresh } from '@/lib/client/hooks';
import { request } from '@/lib/client/http';
import type { Week, WeekWithProgress } from '@/lib/types';
import { ProgressBar } from './ProgressBar';

interface Props {
  goalId: string | undefined;
  weeks: WeekWithProgress[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}

export function WeekPanel({ goalId, weeks, activeId, onSelect }: Props) {
  const refresh = useRefresh();
  const create = useAction();
  const [title, setTitle] = useState('');
  // 주간 시작은 월요일 기준으로 제안한다.
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayString()));

  async function onCreate(event: SyntheticEvent) {
    event.preventDefault();
    if (!goalId) return;
    const ok = await create.run(async () => {
      const week = await request<Week>('POST', '/api/weeks', { title, weekStart, goalId });
      await refresh.weeks();
      onSelect(week.id);
    });
    if (ok) setTitle('');
  }

  return (
    <section className="panel" aria-labelledby="weeks-heading">
      <h2 id="weeks-heading">주간 계획</h2>
      {!goalId ? (
        <p className="empty">먼저 목표를 선택하세요.</p>
      ) : (
        <>
          <ul className="list">
            {weeks.map((week) => (
              <WeekRow key={week.id} week={week} active={week.id === activeId} onSelect={() => onSelect(week.id)} />
            ))}
            {weeks.length === 0 && <li className="empty">이 목표의 주간 계획이 없습니다.</li>}
          </ul>
          <form className="inline-form" onSubmit={onCreate}>
            <input aria-label="주간 계획 제목" placeholder="새 주간 계획" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input aria-label="주간 시작일" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            <button type="submit" disabled={create.pending}>주간 추가</button>
          </form>
          {create.error && <p className="error" role="alert">{create.error}</p>}
        </>
      )}
    </section>
  );
}

function WeekRow({ week, active, onSelect }: { week: WeekWithProgress; active: boolean; onSelect: () => void }) {
  const refresh = useRefresh();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(week.title);
  const [weekStart, setWeekStart] = useState(week.weekStart);

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await request<Week>('PATCH', `/api/weeks/${week.id}`, { title, weekStart });
      await refresh.weeks();
    });
    if (ok) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`"${week.title}" 주간 계획을 삭제할까요?\n소속 할 일 ${week.total}개도 함께 삭제됩니다.`)) return;
    await action.run(async () => {
      await request('DELETE', `/api/weeks/${week.id}`);
      await refresh.everything();
    });
  }

  if (editing) {
    return (
      <li className="row editing">
        <form className="inline-form" onSubmit={save}>
          <input aria-label="주간 계획 제목 수정" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="주간 시작일 수정" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          <button type="submit" disabled={action.pending}>저장</button>
          <button type="button" className="ghost" onClick={() => setEditing(false)}>취소</button>
        </form>
        {action.error && <p className="error" role="alert">{action.error}</p>}
      </li>
    );
  }

  return (
    <li className={`row${active ? ' active' : ''}`}>
      <button type="button" className="row-main" aria-pressed={active} onClick={onSelect}>
        <span className="row-title">{week.title}</span>
        <span className="row-meta">{week.weekStart} · {week.done}/{week.total}</span>
        <ProgressBar value={week.progress} label={`${week.title} 진행률`} />
      </button>
      <div className="actions">
        <button type="button" className="ghost" aria-label={`${week.title} 수정`} onClick={() => setEditing(true)}>수정</button>
        <button type="button" className="ghost danger" aria-label={`${week.title} 삭제`} onClick={remove}>삭제</button>
      </div>
      {action.error && <p className="error" role="alert">{action.error}</p>}
    </li>
  );
}
