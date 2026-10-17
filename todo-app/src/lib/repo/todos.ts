import { ObjectId, type Db, type Filter } from 'mongodb';
import { notFound } from '../errors';
import type { TodoCreateInput, TodoUpdateInput } from '../schemas';
import type { Todo } from '../types';
import { collections, toObjectId, type TodoDoc } from './collections';

function toTodo(doc: TodoDoc): Todo {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    date: doc.date,
    status: doc.status,
    weekId: doc.weekId.toHexString(),
    order: doc.order,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** 본인 소유의 주간 계획인지 확인한다. 남의 주간 계획도 없는 것과 같이 404로 응답한다. */
async function assertWeekExists(db: Db, userId: string, weekId: string): Promise<void> {
  const week = await collections(db).weeks.findOne({ _id: toObjectId(weekId), userId: toObjectId(userId) }, { projection: { _id: 1 } });
  if (!week) throw notFound('주간 계획');
}

/**
 * 해당 주간에서 가장 큰 order보다 큰 값을 반환한다. 시각 기반이라 새 카드는 항상 컬럼 맨 아래에 놓이며,
 * P1에서 두 카드 사이로 옮길 때는 앞뒤 order의 중간값을 쓸 수 있도록 number(실수)로 둔다.
 */
async function nextOrder(db: Db, weekId: ObjectId): Promise<number> {
  const last = await collections(db).todos.findOne({ weekId }, { sort: { order: -1 }, projection: { order: 1 } });
  return Math.max(Date.now(), (last?.order ?? 0) + 1);
}

export async function listTodos(db: Db, userId: string, filter: { weekId?: string; date?: string }): Promise<Todo[]> {
  const query: Filter<TodoDoc> = { userId: toObjectId(userId) };
  if (filter.weekId) query.weekId = toObjectId(filter.weekId);
  if (filter.date) query.date = filter.date;
  // order가 같은 카드(동시 생성 등)도 항상 같은 순서로 나오도록 _id를 보조 키로 둔다.
  const docs = await collections(db).todos.find(query).sort({ order: 1, _id: 1 }).toArray();
  return docs.map(toTodo);
}

export async function getTodo(db: Db, userId: string, id: string): Promise<Todo> {
  const doc = await collections(db).todos.findOne({ _id: toObjectId(id), userId: toObjectId(userId) });
  if (!doc) throw notFound('할 일');
  return toTodo(doc);
}

export async function createTodo(db: Db, userId: string, input: TodoCreateInput): Promise<Todo> {
  await assertWeekExists(db, userId, input.weekId);
  const weekId = toObjectId(input.weekId);
  const now = new Date();
  const doc: TodoDoc = {
    _id: new ObjectId(),
    userId: toObjectId(userId),
    title: input.title,
    date: input.date,
    status: 'todo',
    weekId,
    order: await nextOrder(db, weekId),
    createdAt: now,
    updatedAt: now,
  };
  await collections(db).todos.insertOne(doc);
  return toTodo(doc);
}

/** 상태나 주간 계획이 바뀌면 이동한 컬럼의 맨 아래로 보낸다 (P0에는 컬럼 내 순서 변경 UI가 없다). */
export async function updateTodo(db: Db, userId: string, id: string, input: TodoUpdateInput): Promise<Todo> {
  const { todos } = collections(db);
  const _id = toObjectId(id);
  const owner = toObjectId(userId);
  const current = await todos.findOne({ _id, userId: owner });
  if (!current) throw notFound('할 일');

  if (input.weekId) await assertWeekExists(db, userId, input.weekId);
  const targetWeekId = input.weekId ? toObjectId(input.weekId) : current.weekId;
  const moved =
    (input.status !== undefined && input.status !== current.status) || !targetWeekId.equals(current.weekId);

  const fields = Object.fromEntries(
    Object.entries({ title: input.title, date: input.date, status: input.status }).filter(([, v]) => v !== undefined),
  );
  const doc = await todos.findOneAndUpdate(
    { _id, userId: owner },
    {
      $set: {
        ...fields,
        weekId: targetWeekId,
        ...(moved ? { order: await nextOrder(db, targetWeekId) } : {}),
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('할 일');
  return toTodo(doc);
}

export async function deleteTodo(db: Db, userId: string, id: string): Promise<void> {
  const result = await collections(db).todos.deleteOne({ _id: toObjectId(id), userId: toObjectId(userId) });
  if (result.deletedCount === 0) throw notFound('할 일');
}
