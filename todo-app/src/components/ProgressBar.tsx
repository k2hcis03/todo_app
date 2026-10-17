import { formatPercent } from '@/lib/progress';

export function ProgressBar({ value, label }: { value: number; label: string }) {
  // 표시만 정수로 반올림하고 너비는 실제 값을 쓴다.
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
      <span className="progress-text">{formatPercent(value)}</span>
    </div>
  );
}
