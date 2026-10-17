import { STATUSES, type Status } from './schemas';
import type { Todo } from './types';

export type Columns = Record<Status, Todo[]>;

/** 컬럼(상태)별로 나누고 각 컬럼을 order 오름차순으로 정렬한다. */
export function groupByStatus(todos: ReadonlyArray<Todo>): Columns {
  const columns = Object.fromEntries(STATUSES.map((status) => [status, [] as Todo[]])) as Columns;
  for (const todo of todos) columns[todo.status].push(todo);
  for (const status of STATUSES) columns[status].sort((a, b) => a.order - b.order);
  return columns;
}

/**
 * 카드를 다른 컬럼으로 옮긴 결과를 계산한다 (서버 응답 전 낙관적 업데이트용).
 * 서버(updateTodo)와 같은 규칙으로 이동한 컬럼의 맨 아래에 놓는다. 원본 배열은 변경하지 않는다.
 */
export function moveTodo(todos: Todo[], id: string, status: Status): Todo[] {
  const target = todos.find((todo) => todo.id === id);
  if (!target || target.status === status) return todos;
  const bottom = Math.max(...todos.map((todo) => todo.order)) + 1;
  return todos.map((todo) => (todo.id === id ? { ...todo, status, order: bottom } : todo));
}
