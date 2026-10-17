import type { Db, ObjectId } from 'mongodb';

export interface UserDoc {
  _id: ObjectId;
  /** GitHub 숫자 id. 사용자명이 바뀌어도 같은 사용자로 인식하는 기준이다. */
  githubId: number;
  username: string;
  avatarUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  /** 세션 토큰의 SHA-256 해시. 원본 토큰은 쿠키에만 있고 DB에는 저장하지 않는다. */
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export function authCollections(db: Db) {
  return {
    users: db.collection<UserDoc>('users'),
    sessions: db.collection<SessionDoc>('sessions'),
  };
}
