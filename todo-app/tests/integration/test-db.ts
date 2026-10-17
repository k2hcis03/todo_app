import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ensureIndexes } from '@/lib/db';

export interface TestDb {
  db: Db;
  /** 인메모리 서버 접속 주소와 DB 이름 (CLI 스크립트를 별도 프로세스로 돌릴 때 쓴다) */
  uri: string;
  dbName: string;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

/** 테스트 파일마다 독립된 인메모리 MongoDB를 띄운다. 로컬 MongoDB 설치가 필요 없다. */
export async function startTestDb(): Promise<TestDb> {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  const db = client.db('todo_test');
  await ensureIndexes(db);

  return {
    db,
    uri: server.getUri(),
    dbName: 'todo_test',
    reset: async () => {
      await Promise.all(['goals', 'weeks', 'todos'].map((name) => db.collection(name).deleteMany({})));
    },
    stop: async () => {
      await client.close();
      await server.stop();
    },
  };
}
