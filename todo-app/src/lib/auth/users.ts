import type { Db } from 'mongodb';
import type { AuthUser } from '../types';
import { authCollections, type UserDoc } from './collections';
import type { GithubProfile } from './github';

export function toAuthUser(doc: UserDoc): AuthUser {
  return { id: doc._id.toHexString(), username: doc.username, avatarUrl: doc.avatarUrl };
}

const DUPLICATE_KEY = 11000;

/**
 * GitHub 프로필로 사용자를 만들거나 갱신한다. githubId가 같으면 같은 사용자이며 username·avatarUrl만 최신으로 바꾼다.
 * 첫 로그인이 동시에 두 번 들어와도 고유 인덱스 충돌 시 한 번 더 시도해 한 문서로 수렴한다.
 */
export async function upsertGithubUser(db: Db, profile: GithubProfile): Promise<AuthUser> {
  const { users } = authCollections(db);
  const attempt = async () => {
    const now = new Date();
    const doc = await users.findOneAndUpdate(
      { githubId: profile.githubId },
      {
        $set: { username: profile.username, avatarUrl: profile.avatarUrl, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('사용자 저장 결과를 읽지 못했습니다');
    return toAuthUser(doc);
  };

  try {
    return await attempt();
  } catch (error) {
    if ((error as { code?: number }).code === DUPLICATE_KEY) return attempt();
    throw error;
  }
}
