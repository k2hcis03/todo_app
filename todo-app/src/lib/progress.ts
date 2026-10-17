import type { Status } from './schemas';

/**
 * 주간 진행률(0~100). done 할 일 수 / 연결된 전체 할 일 수 × 100.
 * 소수 그대로 반환하며 연결된 할 일이 0개이면 0이다. 정수 표시는 formatPercent가 맡는다.
 */
export function weekProgress(todos: ReadonlyArray<{ status: Status }>): number {
  const done = todos.filter((todo) => todo.status === 'done').length;
  return progressFromCounts(done, todos.length);
}

/** DB 집계로 얻은 done/total 개수에서 진행률을 계산한다. total이 0이면 0이다. */
export function progressFromCounts(done: number, total: number): number {
  if (total === 0) return 0;
  return (done / total) * 100;
}

/** 화면 표시용 정수 퍼센트 문자열 */
export function formatPercent(progress: number): string {
  return `${Math.round(progress)}%`;
}
