import { ObjectId, type Db } from 'mongodb';
import { notFound } from '../errors';
import type { GoalInput } from '../schemas';
import type { Goal } from '../types';
import { collections, toObjectId, type GoalDoc } from './collections';

function toGoal(doc: GoalDoc): Goal {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    year: doc.year,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listGoals(db: Db, userId: string): Promise<Goal[]> {
  const docs = await collections(db).goals.find({ userId: toObjectId(userId) }).sort({ year: -1, createdAt: 1 }).toArray();
  return docs.map(toGoal);
}

export async function getGoal(db: Db, userId: string, id: string): Promise<Goal> {
  const doc = await collections(db).goals.findOne({ _id: toObjectId(id), userId: toObjectId(userId) });
  if (!doc) throw notFound('목표');
  return toGoal(doc);
}

export async function createGoal(db: Db, userId: string, input: GoalInput): Promise<Goal> {
  const now = new Date();
  const doc: GoalDoc = { _id: new ObjectId(), userId: toObjectId(userId), ...input, createdAt: now, updatedAt: now };
  await collections(db).goals.insertOne(doc);
  return toGoal(doc);
}

export async function updateGoal(db: Db, userId: string, id: string, input: Partial<GoalInput>): Promise<Goal> {
  const doc = await collections(db).goals.findOneAndUpdate(
    { _id: toObjectId(id), userId: toObjectId(userId) },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('목표');
  return toGoal(doc);
}

/**
 * 목표를 삭제하면 하위 주간 계획과 그 할 일까지 연쇄 삭제한다.
 * 단독 MongoDB에서는 트랜잭션을 쓸 수 없어 하위 → 상위 순서로 지운다.
 * 중간에 실패해도 상위가 남으므로 다시 시도하면 이어서 정리된다.
 */
export async function deleteGoal(db: Db, userId: string, id: string): Promise<{ weeks: number; todos: number }> {
  const { goals, weeks, todos } = collections(db);
  const goalId = toObjectId(id);
  const owner = toObjectId(userId);
  if (!(await goals.findOne({ _id: goalId, userId: owner }, { projection: { _id: 1 } }))) throw notFound('목표');

  const weekIds = (await weeks.find({ goalId, userId: owner }, { projection: { _id: 1 } }).toArray()).map((w) => w._id);
  const removedTodos = weekIds.length ? (await todos.deleteMany({ weekId: { $in: weekIds }, userId: owner })).deletedCount : 0;
  const removedWeeks = (await weeks.deleteMany({ goalId, userId: owner })).deletedCount;
  await goals.deleteOne({ _id: goalId, userId: owner });
  return { weeks: removedWeeks, todos: removedTodos };
}
