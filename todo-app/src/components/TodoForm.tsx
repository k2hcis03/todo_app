'use client';

import { useState, type SyntheticEvent } from 'react';
import { todayString } from '@/lib/dates';
import { STATUSES, STATUS_LABEL, type Status } from '@/lib/schemas';
import type { Goal, Todo, WeekWithProgress } from '@/lib/types';

export interface TodoFormValues {
  title: string;
  date: string;
  weekId: string;
  status?: Status;
}

interface Props {
  goals: Goal[];
  weeks: WeekWithProgress[];
  /** 수정할 할 일. 없으면 새로 만든다. */
  initial?: Todo;
  defaultWeekId?: string;
  pending: boolean;
  /** 서버가 돌려준 오류 */
  error: string | null;
  /** 새로 만들 때는 전체 값, 수정할 때는 바뀐 필드만 전달한다. */
  onSubmit: (values: Partial<TodoFormValues>) => void;
  onCancel: () => void;
}

export function TodoForm({ goals, weeks, initial, defaultWeekId, pending, error, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(initial?.date ?? todayString());
  const [weekId, setWeekId] = useState(initial?.weekId ?? defaultWeekId ?? '');
  const [status, setStatus] = useState<Status>(initial?.status ?? 'todo');
  const [validation, setValidation] = useState<string | null>(null);

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!title.trim()) return setValidation('제목을 입력하세요');
    if (!weekId) return setValidation('주간 계획을 선택하세요');
    if (!date) return setValidation('날짜를 입력하세요');
    setValidation(null);

    // 새 할 일의 상태는 서버가 todo로 정한다.
    if (!initial) return onSubmit({ title, date, weekId });

    // 수정은 바뀐 필드만 보낸다. 폼을 열어 둔 사이 드래그로 바뀐 상태를 열 때의 값으로 덮어쓰지 않기 위해서다.
    const changed: Partial<TodoFormValues> = {};
    if (title.trim() !== initial.title) changed.title = title;
    if (date !== initial.date) changed.date = date;
    if (weekId !== initial.weekId) changed.weekId = weekId;
    if (status !== initial.status) changed.status = status;
    if (Object.keys(changed).length === 0) return onCancel();
    onSubmit(changed);
  }

  const message = validation ?? error;
  return (
    <form className="todo-form" onSubmit={submit} aria-label={initial ? '할 일 수정' : '할 일 추가'}>
      <label>
        제목
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="무엇을 할까요?" autoFocus />
      </label>
      <label>
        날짜
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        주간 계획
        <select value={weekId} onChange={(e) => setWeekId(e.target.value)}>
          <option value="">선택하세요</option>
          {goals.map((goal) => {
            const goalWeeks = weeks.filter((week) => week.goalId === goal.id);
            if (goalWeeks.length === 0) return null;
            return (
              <optgroup key={goal.id} label={goal.title}>
                {goalWeeks.map((week) => (
                  <option key={week.id} value={week.id}>{week.title} ({week.weekStart})</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      {initial && (
        <label>
          상태
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>{STATUS_LABEL[value]}</option>
            ))}
          </select>
        </label>
      )}
      <div className="form-actions">
        <button type="submit" disabled={pending}>{initial ? '저장' : '추가'}</button>
        <button type="button" className="ghost" onClick={onCancel}>취소</button>
      </div>
      {message && <p className="error" role="alert">{message}</p>}
    </form>
  );
}
