const pad = (n: number) => String(n).padStart(2, '0');

/** 로컬 시간대 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 주어진 날짜(YYYY-MM-DD)가 속한 주의 월요일. 일요일은 직전 월요일에 속한다. 시간대와 무관하게 UTC로 계산한다. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}
