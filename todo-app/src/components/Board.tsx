'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { groupByStatus, moveTodo } from '@/lib/board-state';
import { useAction, useRefresh, useTodos } from '@/lib/client/hooks';
import { errorMessage, request } from '@/lib/client/http';
import { STATUSES, STATUS_LABEL, type Status } from '@/lib/schemas';
import type { Goal, Todo, WeekWithProgress } from '@/lib/types';
import { columnCollision, columnCoordinateGetter, dropTargetStatus, koreanAccessibility } from './board-dnd';
import { TodoForm, type TodoFormValues } from './TodoForm';

interface Props {
  weekId: string | undefined;
  goals: Goal[];
  weeks: WeekWithProgress[];
}

export function Board({ weekId, goals, weeks }: Props) {
  const { data: todos = [], error: loadError, isLoading, mutate: mutateTodos } = useTodos(weekId);
  const refresh = useRefresh();
  const form = useAction();
  const [editing, setEditing] = useState<Todo | 'new' | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinateGetter }),
  );

  const week = weeks.find((w) => w.id === weekId);
  const visible = dateFilter ? todos.filter((todo) => todo.date === dateFilter) : todos;
  const columns = groupByStatus(visible);
  const titles = new Map(todos.map((todo) => [todo.id, todo.title]));

  /** 낙관적으로 컬럼을 옮기고, 저장에 실패하면 이전 상태로 되돌린 뒤 오류를 보여준다. */
  async function changeStatus(id: string, status: Status) {
    // 같은 컬럼에 다시 놓은 경우에는 요청을 보내지 않는다.
    if (todos.find((todo) => todo.id === id)?.status === status) return;
    setMoveError(null);
    try {
      await mutateTodos(
        async () => {
          await request('PATCH', `/api/todos/${id}`, { status });
          return undefined;
        },
        {
          optimisticData: (current) => moveTodo(current ?? [], id, status),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
    } catch (error) {
      setMoveError(`상태를 저장하지 못해 원래대로 되돌렸습니다: ${errorMessage(error)}`);
    }
    await refresh.weeks();
  }

  function onDragEnd(event: DragEndEvent) {
    const status = dropTargetStatus(event);
    if (status) void changeStatus(String(event.active.id), status);
  }

  /** 새로 만들 때는 전체 값을, 수정할 때는 바뀐 필드만 받는다 (폼이 열린 사이 드래그로 바뀐 상태를 덮어쓰지 않도록). */
  async function submit(values: Partial<TodoFormValues>) {
    if (!editing) return;
    const ok = await form.run(async () => {
      if (editing === 'new') await request('POST', '/api/todos', values);
      else await request('PATCH', `/api/todos/${editing.id}`, values);
      const movedTo = values.weekId && values.weekId !== weekId ? values.weekId : undefined;
      await Promise.all([mutateTodos(), refresh.weeks(), movedTo ? refresh.todos(movedTo) : undefined]);
    });
    if (ok) setEditing(null);
  }

  async function remove(todo: Todo) {
    if (!window.confirm(`"${todo.title}" 할 일을 삭제할까요?`)) return;
    setMoveError(null);
    try {
      await request('DELETE', `/api/todos/${todo.id}`);
      await Promise.all([mutateTodos(), refresh.weeks()]);
    } catch (error) {
      setMoveError(errorMessage(error));
    }
  }

  function openForm(next: Todo | 'new' | null) {
    form.setError(null);
    setEditing(next);
  }

  return (
    <section className="board-area" aria-labelledby="board-heading">
      <header className="board-header">
        <h2 id="board-heading">{week ? `${week.title} 보드` : '보드'}</h2>
        {week && (
          <div className="board-tools">
            <label className="date-filter">
              날짜 필터
              <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            </label>
            {dateFilter && (
              <button type="button" className="ghost" onClick={() => setDateFilter('')}>필터 해제</button>
            )}
            <button type="button" onClick={() => openForm('new')}>할 일 추가</button>
          </div>
        )}
      </header>

      {!week ? (
        <p className="empty">왼쪽에서 주간 계획을 선택하면 할 일 보드가 나타납니다.</p>
      ) : (
        <>
          {editing && (
            <TodoForm
              key={editing === 'new' ? 'new' : editing.id}
              goals={goals}
              weeks={weeks}
              initial={editing === 'new' ? undefined : editing}
              defaultWeekId={weekId}
              pending={form.pending}
              error={form.error}
              onSubmit={submit}
              onCancel={() => openForm(null)}
            />
          )}
          {loadError && <p className="error" role="alert">할 일을 불러오지 못했습니다: {errorMessage(loadError)}</p>}
          {moveError && <p className="error" role="alert">{moveError}</p>}
          {isLoading && <p className="empty">불러오는 중…</p>}

          <DndContext
            sensors={sensors}
            collisionDetection={columnCollision}
            onDragEnd={onDragEnd}
            accessibility={koreanAccessibility(titles)}
          >
            <div className="columns">
              {STATUSES.map((status) => (
                <Column key={status} status={status} count={columns[status].length}>
                  {columns[status].map((todo) => (
                    <TodoCard
                      key={todo.id}
                      todo={todo}
                      onEdit={() => openForm(todo)}
                      onDelete={() => remove(todo)}
                      onStatus={(next) => changeStatus(todo.id, next)}
                    />
                  ))}
                </Column>
              ))}
            </div>
          </DndContext>
        </>
      )}
    </section>
  );
}

function Column({ status, count, children }: { status: Status; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`column column-${status}${isOver ? ' over' : ''}`}
      aria-label={`${STATUS_LABEL[status]} 컬럼`}
      data-status={status}
    >
      <h3>
        {STATUS_LABEL[status]} <span className="count">{count}</span>
      </h3>
      <ul className="cards">{children}</ul>
      {count === 0 && <p className="empty small">비어 있음</p>}
    </section>
  );
}

function TodoCard({
  todo,
  onEdit,
  onDelete,
  onStatus,
}: {
  todo: Todo;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (status: Status) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.id,
    attributes: { roleDescription: '이동 가능한 카드' },
  });
  return (
    <li
      ref={setNodeRef}
      className={`card${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
      data-testid={`card-${todo.title}`}
    >
      <div className="card-top">
        <button type="button" className="handle" aria-label={`${todo.title} 이동`} {...attributes} {...listeners}>
          ⠿
        </button>
        <span className="card-title">{todo.title}</span>
      </div>
      <div className="card-meta">
        <time dateTime={todo.date}>{todo.date}</time>
        <select
          aria-label={`${todo.title} 상태 변경`}
          value={todo.status}
          onChange={(e) => onStatus(e.target.value as Status)}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>{STATUS_LABEL[status]}</option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button type="button" className="ghost" aria-label={`${todo.title} 수정`} onClick={onEdit}>수정</button>
        <button type="button" className="ghost danger" aria-label={`${todo.title} 삭제`} onClick={onDelete}>삭제</button>
      </div>
    </li>
  );
}
