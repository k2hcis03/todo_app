import { describe, expect, it } from 'vitest';
import { groupByStatus, moveTodo } from '@/lib/board-state';
import type { Todo } from '@/lib/types';

const base = { date: '2026-10-19', weekId: 'w1', createdAt: '', updatedAt: '' };
const todo = (id: string, status: Todo['status'], order: number): Todo => ({
  ...base,
  id,
  title: id,
  status,
  order,
});

describe('groupByStatus', () => {
  it('세 컬럼으로 나누고 각 컬럼을 order 오름차순으로 정렬한다', () => {
    const grouped = groupByStatus([todo('b', 'todo', 2), todo('a', 'todo', 1), todo('c', 'done', 3)]);
    expect(grouped.todo.map((t) => t.id)).toEqual(['a', 'b']);
    expect(grouped.doing).toEqual([]);
    expect(grouped.done.map((t) => t.id)).toEqual(['c']);
  });
});

describe('moveTodo (낙관적 업데이트)', () => {
  const list = [todo('a', 'todo', 1), todo('b', 'todo', 2), todo('c', 'doing', 3)];

  it('다른 컬럼으로 옮기면 status가 바뀌고 그 컬럼의 맨 아래(가장 큰 order)로 간다', () => {
    const next = moveTodo(list, 'a', 'doing');
    const moved = next.find((t) => t.id === 'a')!;
    expect(moved.status).toBe('doing');
    expect(moved.order).toBeGreaterThan(3);
  });

  it('같은 컬럼이면 목록을 그대로 반환한다', () => {
    expect(moveTodo(list, 'a', 'todo')).toBe(list);
  });

  it('없는 id면 목록을 그대로 반환하고 원본을 변경하지 않는다', () => {
    expect(moveTodo(list, 'zzz', 'done')).toBe(list);
    moveTodo(list, 'a', 'done');
    expect(list[0].status).toBe('todo');
  });
});
