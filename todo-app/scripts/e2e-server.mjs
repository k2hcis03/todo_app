// E2E용 서버: 인메모리 MongoDB와 가짜 GitHub 서버를 띄우고, 그 주소를 환경 변수로 넘겨 Next.js를 실행한다.
// 로컬에 MongoDB가 없어도, 실제 GitHub·실제 DB(.env.local)를 건드리지 않고
// `npm run test:e2e`만으로 로그인부터 할 일 관리까지 전체 흐름을 검증할 수 있다.
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startFakeGithub } from './fake-github.mjs';

const port = process.env.E2E_PORT ?? '3100';
const githubPort = Number(process.env.E2E_GITHUB_PORT ?? '4010');
// 기본은 프로덕션 빌드(next build → next start)로 실제 동작과 같게 검증한다.
// 빠른 반복이 필요하면 E2E_MODE=dev 로 개발 서버를 쓴다.
const mode = process.env.E2E_MODE === 'dev' ? 'dev' : 'start';

const CLIENT_ID = 'e2e-client-id';
const CLIENT_SECRET = 'e2e-client-secret';

const mongo = await MongoMemoryServer.create();
const github = startFakeGithub({
  port: githubPort,
  appBase: `http://127.0.0.1:${port}`,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// 여기서 명시한 값은 .env.local보다 우선한다 (Next.js는 이미 설정된 환경 변수를 덮어쓰지 않는다).
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DB: 'todo_e2e',
  GITHUB_CLIENT_ID: CLIENT_ID,
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_OAUTH_URL: `http://127.0.0.1:${githubPort}`,
  GITHUB_API_URL: `http://127.0.0.1:${githubPort}`,
};

function run(command) {
  return spawn(command, { shell: true, stdio: 'inherit', env });
}

async function shutdown(code) {
  await github.close();
  await mongo.stop();
  process.exit(code);
}

if (mode === 'start') {
  const build = run('npx next build');
  const code = await new Promise((resolve) => build.on('exit', resolve));
  if (code !== 0) await shutdown(code ?? 1);
}

const server = run(mode === 'dev' ? `npx next dev -p ${port}` : `npx next start -p ${port}`);

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.kill();
  await shutdown(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('exit', (code) => stop(code ?? 0));
