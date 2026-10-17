// E2E 전용 가짜 GitHub 서버. 실제 GitHub의 OAuth 흐름 중 앱이 쓰는 부분만 흉내 낸다.
//   GET  /login/oauth/authorize     승인 화면 대신 곧바로 앱의 콜백으로 302 (code, state 전달)
//   POST /login/oauth/access_token  client_id/client_secret/code 검사 후 액세스 토큰 발급
//   GET  /user                      토큰으로 사용자 정보(id, login, avatar_url) 조회
//   POST /__login_as                다음 로그인에서 어떤 GitHub 사용자로 승인할지(또는 거부할지) 정한다
import http from 'node:http';

// 1x1 PNG (아바타 이미지 자리)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** @param {{ port: number, appBase: string, clientId: string, clientSecret: string }} options */
export function startFakeGithub({ port, appBase, clientId, clientSecret }) {
  let loginAs = 'alice';
  let deny = false;
  const idFor = (login) => 1000 + [...login].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    const readJson = () =>
      new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data ? JSON.parse(data) : {}));
      });

    if (url.pathname === '/login/oauth/authorize') {
      // 등록되지 않은 client_id는 실제 GitHub처럼 404를 돌려준다.
      if (url.searchParams.get('client_id') !== clientId) return send(404, 'Not Found', 'text/plain');
      const target = new URL('/auth/github/callback', appBase);
      if (deny) target.searchParams.set('error', 'access_denied');
      else target.searchParams.set('code', `code-${loginAs}-${Date.now()}`);
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: target.toString() });
      return res.end();
    }

    if (url.pathname === '/login/oauth/access_token' && req.method === 'POST') {
      const body = await readJson();
      // 실제 GitHub처럼 실패해도 HTTP 200과 { error } 본문을 돌려준다.
      if (body.client_id !== clientId || body.client_secret !== clientSecret) return send(200, { error: 'incorrect_client_credentials' });
      const match = /^code-(.+)-\d+$/.exec(body.code ?? '');
      if (!match) return send(200, { error: 'bad_verification_code' });
      return send(200, { access_token: `token-${match[1]}`, token_type: 'bearer', scope: 'read:user' });
    }

    if (url.pathname === '/user') {
      const match = /^Bearer token-(.+)$/.exec(req.headers.authorization ?? '');
      if (!match) return send(401, { message: 'Bad credentials' });
      return send(200, { id: idFor(match[1]), login: match[1], avatar_url: `http://127.0.0.1:${port}/avatars/${match[1]}.png` });
    }

    if (url.pathname.startsWith('/avatars/')) return send(200, PNG, 'image/png');

    if (url.pathname === '/__login_as' && req.method === 'POST') {
      const body = await readJson();
      loginAs = String(body.login ?? 'alice');
      deny = Boolean(body.deny);
      return send(204, '');
    }

    return send(404, { message: 'Not Found' });
  });

  server.listen(port, '127.0.0.1');
  return { close: () => new Promise((resolve) => server.close(resolve)) };
}
