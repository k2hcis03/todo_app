// 로그인 기능 추가 전에 만든 데이터(userId 없음)를 지정한 GitHub 사용자에게 할당한다.
//
// 사용법 (먼저 그 사용자로 한 번 로그인해 users에 등록되어 있어야 한다):
//   npm run migrate:user-id -- --github-login <GitHub 사용자명>            # dry-run: 대상 개수만 보여 준다
//   npm run migrate:user-id -- --github-login <GitHub 사용자명> --apply    # 실제로 할당한다
//
// userId가 없는 문서는 어느 사용자의 화면에도 보이지 않으므로, 이 스크립트를 돌리기 전까지는 안전하게 숨겨져 있다.
// 여러 번 실행해도 안전하다(이미 소유자가 있는 문서는 건드리지 않는다).
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

const COLLECTIONS = ['goals', 'weeks', 'todos'];
const UNOWNED = { userId: null }; // 필드가 없거나 null인 문서

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {import('mongodb').Db} db
 * @param {{ githubLogin?: string, apply?: boolean }} options
 */
export async function migrateUserId(db, { githubLogin, apply = false } = {}) {
  const login = githubLogin?.trim();
  if (!login) throw new Error('--github-login <GitHub 사용자명>이 필요합니다');

  // GitHub 로그인명은 대소문자를 구분하지 않는다. 정규식 특수문자는 이스케이프해 정확 일치로만 찾는다.
  const matches = await db
    .collection('users')
    .find({ username: { $regex: `^${escapeRegExp(login)}$`, $options: 'i' } })
    .limit(2)
    .toArray();
  if (matches.length === 0) throw new Error(`사용자 '${login}'을(를) 찾을 수 없습니다. 먼저 그 GitHub 계정으로 로그인해 주세요`);
  // 사용자명은 바뀌거나 재사용될 수 있어 고유하지 않다. 모호하면 엉뚱한 계정에 데이터를 넘기지 않도록 중단한다.
  if (matches.length > 1) throw new Error(`사용자명 '${login}'과(와) 일치하는 계정이 2건 이상이라 어느 쪽인지 알 수 없어 중단합니다`);
  const [user] = matches;

  /** @type {Record<string, number>} */
  const counts = {};
  for (const name of COLLECTIONS) {
    const collection = db.collection(name);
    counts[name] = await collection.countDocuments(UNOWNED);
    if (apply && counts[name] > 0) await collection.updateMany(UNOWNED, { $set: { userId: user._id } });
  }

  return { applied: apply, user: { id: user._id.toHexString(), username: user.username }, counts };
}

function parseArgs(argv) {
  const args = { apply: false, githubLogin: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--github-login') args.githubLogin = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.githubLogin) {
    console.error('사용법: npm run migrate:user-id -- --github-login <GitHub 사용자명> [--apply]');
    console.error('--github-login이 필요합니다. --apply 없이 실행하면 변경 없이 대상 개수만 보여 줍니다(dry-run).');
    return 1;
  }

  if (!process.env.MONGODB_URI && existsSync('.env.local')) process.loadEnvFile('.env.local');
  const { MONGODB_URI, MONGODB_DB } = process.env;
  if (!MONGODB_URI || !MONGODB_DB) {
    console.error('MONGODB_URI와 MONGODB_DB가 필요합니다 (.env.local 또는 환경 변수)');
    return 1;
  }

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const result = await migrateUserId(client.db(MONGODB_DB), args);
    console.log(`대상 사용자: ${result.user.username}`);
    console.log(`userId가 없는 문서 — ${COLLECTIONS.map((name) => `${name}: ${result.counts[name]}`).join(', ')}`);
    console.log(
      result.applied
        ? '할당을 완료했습니다.'
        : '(dry-run) 변경하지 않았습니다. 실제로 할당하려면 --apply를 붙여 다시 실행하세요.',
    );
    return 0;
  } catch (error) {
    // 연결 문자열이 메시지에 섞여 나오지 않도록 접속 주소 형태는 가린다.
    console.error(String(error instanceof Error ? error.message : error).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>'));
    return 1;
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
