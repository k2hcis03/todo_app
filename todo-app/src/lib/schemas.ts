import { z } from 'zod';

export const STATUSES = ['todo', 'doing', 'done'] as const;
export type Status = (typeof STATUSES)[number];

/** 화면과 스크린리더 안내에 쓰는 상태 이름 */
export const STATUS_LABEL: Record<Status, string> = { todo: '할 일', doing: '진행 중', done: '완료' };

export const statusSchema = z.enum(STATUSES);

/** 24자리 16진수만 허용한다. ObjectId.isValid는 12바이트 문자열도 통과시켜 쓰지 않는다. */
export const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, '올바른 id 형식이 아닙니다');

/** YYYY-MM-DD 형식이며 달력에 실제로 존재하는 날짜여야 한다. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '존재하지 않는 날짜입니다');

const title = z.string().trim().min(1, '제목을 입력하세요').max(200, '제목은 200자 이하여야 합니다');

export const goalInputSchema = z.object({
  title,
  year: z.number().int().min(2000).max(2100),
});

export const weekInputSchema = z.object({
  title,
  weekStart: dateString,
  goalId: objectIdString,
});

// 새 할 일의 상태는 항상 todo다. 요청에 status가 있어도 zod가 버리고 저장소가 todo로 고정한다.
export const todoCreateSchema = z.object({
  title,
  date: dateString,
  weekId: objectIdString,
});

export const todoUpdateSchema = z
  .object({
    title,
    date: dateString,
    weekId: objectIdString,
    status: statusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '수정할 필드가 없습니다');

export const goalUpdateSchema = goalInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '수정할 필드가 없습니다');

export const weekUpdateSchema = weekInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '수정할 필드가 없습니다');

export type GoalInput = z.infer<typeof goalInputSchema>;
export type WeekInput = z.infer<typeof weekInputSchema>;
export type TodoCreateInput = z.infer<typeof todoCreateSchema>;
export type TodoUpdateInput = z.infer<typeof todoUpdateSchema>;
