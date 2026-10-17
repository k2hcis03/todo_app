'use client';

import { useState, type SyntheticEvent } from 'react';
import { useAction, useRefresh } from '@/lib/client/hooks';
import { request } from '@/lib/client/http';
import type { Goal } from '@/lib/types';

interface Props {
  goals: Goal[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}

export function GoalPanel({ goals, activeId, onSelect }: Props) {
  const refresh = useRefresh();
  const create = useAction();
  const [title, setTitle] = useState('');
  const [year, setYear] = useState(() => String(new Date().getFullYear()));

  async function onCreate(event: SyntheticEvent) {
    event.preventDefault();
    const ok = await create.run(async () => {
      const goal = await request<Goal>('POST', '/api/goals', { title, year: Number(year) });
      await refresh.goals();
      onSelect(goal.id);
    });
    if (ok) setTitle('');
  }

  return (
    <section className="panel" aria-labelledby="goals-heading">
      <h2 id="goals-heading">1년 목표</h2>
      <ul className="list">
        {goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} active={goal.id === activeId} onSelect={() => onSelect(goal.id)} />
        ))}
        {goals.length === 0 && <li className="empty">목표를 만들어 시작하세요.</li>}
      </ul>

      <form className="inline-form" onSubmit={onCreate}>
        <input aria-label="목표 제목" placeholder="새 목표" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="목표 연도" type="number" className="year" value={year} onChange={(e) => setYear(e.target.value)} />
        <button type="submit" disabled={create.pending}>목표 추가</button>
      </form>
      {create.error && <p className="error" role="alert">{create.error}</p>}
    </section>
  );
}

function GoalRow({ goal, active, onSelect }: { goal: Goal; active: boolean; onSelect: () => void }) {
  const refresh = useRefresh();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [year, setYear] = useState(String(goal.year));

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await request<Goal>('PATCH', `/api/goals/${goal.id}`, { title, year: Number(year) });
      await refresh.goals();
    });
    if (ok) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`"${goal.title}" 목표를 삭제할까요?\n하위 주간 계획과 할 일도 모두 삭제됩니다.`)) return;
    await action.run(async () => {
      await request('DELETE', `/api/goals/${goal.id}`);
      await refresh.everything();
    });
  }

  if (editing) {
    return (
      <li className="row editing">
        <form className="inline-form" onSubmit={save}>
          <input aria-label="목표 제목 수정" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="목표 연도 수정" type="number" className="year" value={year} onChange={(e) => setYear(e.target.value)} />
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
        <span className="row-title">{goal.title}</span>
        <span className="row-meta">{goal.year}</span>
      </button>
      <div className="actions">
        <button type="button" className="ghost" aria-label={`${goal.title} 수정`} onClick={() => setEditing(true)}>수정</button>
        <button type="button" className="ghost danger" aria-label={`${goal.title} 삭제`} onClick={remove}>삭제</button>
      </div>
      {action.error && <p className="error" role="alert">{action.error}</p>}
    </li>
  );
}
