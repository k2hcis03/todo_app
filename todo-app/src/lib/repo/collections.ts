import { ObjectId, type Db } from 'mongodb';
import type { Status } from '../schemas';

// MongoDB에 저장되는 문서 형태. 날짜는 Date, 참조는 ObjectId.
export interface GoalDoc {
  _id: ObjectId;
  /** 소유자(로그인한 사용자). 모든 조회·변경이 이 값으로 범위가 제한된다. */
  userId: ObjectId;
  title: string;
  year: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeekDoc {
  _id: ObjectId;
  userId: ObjectId;
  title: string;
  weekStart: string;
  goalId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface TodoDoc {
  _id: ObjectId;
  userId: ObjectId;
  title: string;
  date: string;
  status: Status;
  weekId: ObjectId;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function collections(db: Db) {
  return {
    goals: db.collection<GoalDoc>('goals'),
    weeks: db.collection<WeekDoc>('weeks'),
    todos: db.collection<TodoDoc>('todos'),
  };
}

/** 입력 경계(zod)에서 형식이 검증된 24자리 16진수 문자열을 ObjectId로 바꾼다. */
export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}
