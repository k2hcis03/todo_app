import { MongoClient, type Db } from 'mongodb';

const DEFAULT_DB_NAME = 'todo_app';

interface MongoCache {
  client?: Promise<MongoClient>;
  indexed?: Promise<void>;
}

// dev 서버의 HMR이 모듈을 다시 평가해도 연결이 늘어나지 않도록 global에 캐시한다.
const globalCache = globalThis as typeof globalThis & { __todoMongo?: MongoCache };
const cache: MongoCache = (globalCache.__todoMongo ??= {});

/** 컬렉션별 조회 패턴에 맞춘 인덱스를 만든다. 이미 있으면 아무 일도 하지 않는다. */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('weeks').createIndex({ goalId: 1 }),
    db.collection('todos').createIndex({ weekId: 1 }),
    db.collection('todos').createIndex({ status: 1 }),
    db.collection('todos').createIndex({ date: 1 }),
    // 모든 조회가 userId로 범위가 제한되므로 소유자별 조회용 인덱스를 둔다.
    db.collection('goals').createIndex({ userId: 1 }),
    db.collection('weeks').createIndex({ userId: 1 }),
    db.collection('todos').createIndex({ userId: 1 }),
    db.collection('users').createIndex({ githubId: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    // 만료 시각이 지나면 MongoDB가 세션 문서를 자동으로 지운다 (삭제 지연은 최대 약 1분).
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

/** 앱 서버에서 쓰는 Db 핸들. 환경 변수는 호출 시점에 읽으므로 빌드 단계에서는 연결하지 않는다. */
export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI 환경 변수가 필요합니다 (.env.example 참고)');
  // DB 이름을 빼먹은 배포 때문에 모든 요청(로그인 포함)이 500으로 깨지지 않도록 기본값을 둔다.
  const dbName = process.env.MONGODB_DB || DEFAULT_DB_NAME;

  cache.client ??= MongoClient.connect(uri).catch((error) => {
    // 실패한 연결을 캐시하면 서버를 재시작할 때까지 복구되지 않는다.
    cache.client = undefined;
    throw error;
  });
  const client = await cache.client;
  const db = client.db(dbName);

  cache.indexed ??= ensureIndexes(db).catch((error) => {
    cache.indexed = undefined;
    throw error;
  });
  await cache.indexed;
  return db;
}
