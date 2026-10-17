import { ObjectId, type Db, type Document, type Filter } from 'mongodb';
import { notFound } from '../errors';
import { progressFromCounts } from '../progress';
import type { WeekInput } from '../schemas';
import type { Week, WeekWithProgress } from '../types';
import { collections, toObjectId, type WeekDoc } from './collections';

function toWeek(doc: WeekDoc): Week {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    weekStart: doc.weekStart,
    goalId: doc.goalId.toHexString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

interface WeekAggregate extends WeekDoc {
  counts: Array<{ _id: string; n: number }>;
}

/**
 * weeks를 기준으로 todos를 $lookup해 한 번에 진행률을 구한다 (N+1 방지).
 * weeks가 기준이라 할 일이 없는 주간도 결과에 포함되어 total 0, progress 0이 된다.
 */
async function weeksWithProgress(db: Db, match: Filter<WeekDoc>): Promise<WeekWithProgress[]> {
  const pipeline: Document[] = [
    { $match: match },
    {
      $lookup: {
        from: 'todos',
        localField: '_id',
        foreignField: 'weekId',
        pipeline: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        as: 'counts',
      },
    },
    { $sort: { weekStart: 1, createdAt: 1 } },
  ];
  const docs = await collections(db).weeks.aggregate<WeekAggregate>(pipeline).toArray();

  return docs.map((doc) => {
    const total = doc.counts.reduce((sum, c) => sum + c.n, 0);
    const done = doc.counts.find((c) => c._id === 'done')?.n ?? 0;
    return { ...toWeek(doc), total, done, progress: progressFromCounts(done, total) };
  });
}

export function listWeeks(db: Db, userId: string, filter: { goalId?: string }): Promise<WeekWithProgress[]> {
  const owner = toObjectId(userId);
  return weeksWithProgress(db, filter.goalId ? { userId: owner, goalId: toObjectId(filter.goalId) } : { userId: owner });
}

export async function getWeek(db: Db, userId: string, id: string): Promise<WeekWithProgress> {
  const [week] = await weeksWithProgress(db, { _id: toObjectId(id), userId: toObjectId(userId) });
  if (!week) throw notFound('주간 계획');
  return week;
}

/** 본인 소유의 목표인지 확인한다. 남의 목표도 없는 것과 같이 404로 응답해 존재를 알려주지 않는다. */
async function assertGoalExists(db: Db, userId: string, goalId: string): Promise<void> {
  const goal = await collections(db).goals.findOne({ _id: toObjectId(goalId), userId: toObjectId(userId) }, { projection: { _id: 1 } });
  if (!goal) throw notFound('목표');
}

export async function createWeek(db: Db, userId: string, input: WeekInput): Promise<Week> {
  await assertGoalExists(db, userId, input.goalId);
  const now = new Date();
  const doc: WeekDoc = {
    _id: new ObjectId(),
    userId: toObjectId(userId),
    title: input.title,
    weekStart: input.weekStart,
    goalId: toObjectId(input.goalId),
    createdAt: now,
    updatedAt: now,
  };
  await collections(db).weeks.insertOne(doc);
  return toWeek(doc);
}

export async function updateWeek(db: Db, userId: string, id: string, input: Partial<WeekInput>): Promise<Week> {
  const { goalId, ...rest } = input;
  if (goalId) await assertGoalExists(db, userId, goalId);
  const doc = await collections(db).weeks.findOneAndUpdate(
    { _id: toObjectId(id), userId: toObjectId(userId) },
    { $set: { ...rest, ...(goalId ? { goalId: toObjectId(goalId) } : {}), updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('주간 계획');
  return toWeek(doc);
}

/** 주간 계획과 소속 할 일을 함께 삭제한다 (하위 → 상위 순서). */
export async function deleteWeek(db: Db, userId: string, id: string): Promise<{ todos: number }> {
  const { weeks, todos } = collections(db);
  const weekId = toObjectId(id);
  const owner = toObjectId(userId);
  if (!(await weeks.findOne({ _id: weekId, userId: owner }, { projection: { _id: 1 } }))) throw notFound('주간 계획');
  const removed = (await todos.deleteMany({ weekId, userId: owner })).deletedCount;
  await weeks.deleteOne({ _id: weekId, userId: owner });
  return { todos: removed };
}
