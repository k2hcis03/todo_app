import { createHash, randomBytes } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import type { AuthUser } from '../types';
import { authCollections, type SessionDoc } from './collections';
import { toAuthUser } from './users';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** 새 세션을 만든다. 원본 토큰은 호출자(쿠키)에게만 돌려주고 DB에는 해시만 남긴다. */
export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const doc: SessionDoc = {
    _id: new ObjectId(),
    tokenHash: hashToken(token),
    userId: new ObjectId(userId),
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  };
  await authCollections(db).sessions.insertOne(doc);
  return { token, expiresAt: doc.expiresAt };
}

/**
 * 토큰으로 로그인한 사용자를 찾는다. 없거나 만료되었거나 사용자가 사라졌으면 null.
 * TTL 인덱스는 만료 후 최대 약 1분 뒤에야 문서를 지우므로 만료 시각을 직접 비교한다.
 */
export async function getSessionUser(db: Db, token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const { sessions, users } = authCollections(db);
  const session = await sessions.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await users.findOne({ _id: session.userId });
  return user ? toAuthUser(user) : null;
}

/** 세션 문서를 DB에서 삭제한다 (로그아웃). 이미 없어도 오류 없이 끝난다. */
export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await authCollections(db).sessions.deleteOne({ tokenHash: hashToken(token) });
}
