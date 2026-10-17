// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressBar } from '@/components/ProgressBar';
import { TodoForm } from '@/components/TodoForm';
import { weekProgress } from '@/lib/progress';
import type { Goal, Todo, WeekWithProgress } from '@/lib/types';

afterEach(cleanup);

const goal: Goal = { id: 'g1', title: '건강', year: 2026, createdAt: '', updatedAt: '' };
const week: WeekWithProgress = {
  id: 'w1',
  title: '1주차',
  weekStart: '2026-10-19',
  goalId: 'g1',
  createdAt: '',
  updatedAt: '',
  total: 3,
  done: 1,
  progress: weekProgress([{ status: 'done' }, { status: 'todo' }, { status: 'todo' }]),
};

describe('ProgressBar', () => {
  it('3개 중 1개 완료는 화면에 33%로 표시하고 막대 너비는 소수 그대로 쓴다', () => {
    const { container } = render(<ProgressBar value={week.progress} label="1주차 진행률" />);
    expect(screen.getByRole('progressbar', { name: '1주차 진행률' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.progress-fill')?.style.width).toMatch(/^33\.33/);
  });

  it('0개는 0%로 표시한다', () => {
    render(<ProgressBar value={0} label="빈 주간 진행률" />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});

describe('TodoForm', () => {
  const setup = (props: Partial<Parameters<typeof TodoForm>[0]> = {}) => {
    const onSubmit = vi.fn();
    render(
      <TodoForm goals={[goal]} weeks={[week]} pending={false} error={null} onSubmit={onSubmit} onCancel={() => {}} {...props} />,
    );
    return { onSubmit, user: userEvent.setup() };
  };

  it('주간 계획을 고르지 않으면 검증 오류를 보이고 제출하지 않는다', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByRole('textbox', { name: '제목' }), '운동');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(screen.getByRole('alert')).toHaveTextContent('주간 계획을 선택하세요');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('빈 제목은 거부한다', async () => {
    const { onSubmit, user } = setup({ defaultWeekId: 'w1' });
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(screen.getByRole('alert')).toHaveTextContent('제목을 입력하세요');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('새 할 일은 상태 없이 제출한다 (서버 기본값 todo)', async () => {
    const { onSubmit, user } = setup({ defaultWeekId: 'w1' });
    await user.type(screen.getByRole('textbox', { name: '제목' }), '운동');
    await user.click(screen.getByRole('button', { name: '추가' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][0];
    expect(values).toMatchObject({ title: '운동', weekId: 'w1' });
    expect(values).not.toHaveProperty('status');
  });

  const existing: Todo = {
    id: 't1', title: '운동', date: '2026-10-19', status: 'todo', weekId: 'w1', order: 1, createdAt: '', updatedAt: '',
  };

  it('수정할 때는 바뀐 필드만 제출한다 (폼을 연 사이 바뀐 다른 값을 덮어쓰지 않기 위해)', async () => {
    const { onSubmit, user } = setup({ initial: existing });
    await user.selectOptions(screen.getByRole('combobox', { name: /상태/ }), 'done');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ status: 'done' });
  });

  it('수정에서 아무것도 바꾸지 않으면 요청 없이 닫는다', async () => {
    const onCancel = vi.fn();
    const { onSubmit, user } = setup({ initial: existing, onCancel });
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('서버 오류 메시지를 표시한다', () => {
    setup({ error: '주간 계획 항목을 찾을 수 없습니다' });
    expect(screen.getByRole('alert')).toHaveTextContent('찾을 수 없습니다');
  });
});
