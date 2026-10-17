# 할 일 관리 앱

1년 목표 → 주간 계획 → 일일 할 일을 연결해 관리하고, 보드(할 일 / 진행 중 / 완료)에서 카드를 드래그해 상태를 바꾸는 앱입니다.
주간 진행률은 직접 입력하지 않고 `완료한 할 일 수 / 연결된 전체 할 일 수 × 100`으로 자동 계산됩니다(할 일이 없으면 0%).
**GitHub 계정으로 로그인**해야 쓸 수 있고, 각 사용자는 본인의 데이터만 볼 수 있습니다.

- 기획 문서: `../docs/prd.md`(요구사항), `../docs/plan.md`(구현 계획), `../docs/LOGIN.md`(로그인 요구사항)
- 스택: Next.js(App Router) + TypeScript, MongoDB(공식 드라이버), SWR, dnd-kit
- 백엔드: 별도 서버 없이 Next.js Route Handlers(`src/app/**/route.ts`)가 MongoDB에 직접 연결합니다.

## 실행 방법

필요한 것: Node.js(Next.js 16 요구 버전 이상, 개발은 Node 24에서 검증), MongoDB(로컬 설치 또는 MongoDB Atlas), GitHub OAuth App(아래 설정 가이드).

```bash
npm install
cp .env.example .env.local   # 값을 채운다 (.env.local은 커밋하지 않는다)
npm run dev                  # http://localhost:3000
```

### 환경 변수

| 이름 | 설명 | 예시 |
|---|---|---|
| `MONGODB_URI` | MongoDB 연결 문자열 | `mongodb://127.0.0.1:27017` 또는 Atlas의 `mongodb+srv://...` |
| `MONGODB_DB` | 사용할 데이터베이스 이름 (생략하면 `todo_app`) | `todo_app` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App의 Client ID | GitHub에서 발급 |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App의 Client secret. **소스에 적지 말고 환경 변수로만 둡니다.** | GitHub에서 발급 |

값이 없으면 해당 기능이 500 오류(로그인은 "서버 설정 문제" 안내)를 내며, 서버 로그에 필요한 변수가 안내됩니다. 필요한 인덱스는 첫 연결 때 자동으로 만들어집니다.

> 이 두 값(`GITHUB_OAUTH_URL`, `GITHUB_API_URL`)은 테스트가 가짜 GitHub 서버를 가리킬 때만 쓰며, 실제 사용에서는 설정하지 않습니다.

### GitHub OAuth 설정

1. GitHub에서 **Settings → Developer settings → OAuth Apps → New OAuth App**을 엽니다.
2. 아래처럼 입력하고 등록합니다.
   - **Application name**: 아무 이름 (예: `todo-app`)
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/github/callback` ← 주소가 이 값과 **정확히** 같아야 합니다.
3. 등록 후 보이는 **Client ID**를 `GITHUB_CLIENT_ID`에, **Generate a new client secret**으로 만든 값을 `GITHUB_CLIENT_SECRET`에 넣습니다(`.env.local`). Client ID는 `Ov23li…`처럼 보통 20자 안팎이며, 사용자명이나 앱 이름이 아닙니다.
4. 서버를 다시 시작하고 `http://localhost:3000`에서 **GitHub로 로그인**을 누릅니다.

다른 주소(도메인·다른 포트)로 배포하면 GitHub 앱의 Homepage URL과 Authorization callback URL도 그 주소로 바꿔야 합니다. `localhost`와 `127.0.0.1`은 브라우저가 서로 다른 사이트로 취급하니 한쪽으로 통일해서 접속하세요.

### 기존 데이터 옮기기 (로그인 기능 추가 이전 데이터)

로그인 기능을 넣기 전에 만든 데이터에는 소유자(`userId`)가 없습니다. 이 데이터는 **어느 사용자에게도 보이지 않으므로**(숨겨진 채 안전하게 보관됨), 가져올 사용자에게 할당하는 한 번의 작업이 필요합니다.

```bash
# 1) 옮겨 받을 GitHub 계정으로 앱에 한 번 로그인해 둡니다.
# 2) 대상 개수만 확인 (아무것도 바꾸지 않음)
npm run migrate:user-id -- --github-login <GitHub 사용자명>
# 3) 실제로 할당
npm run migrate:user-id -- --github-login <GitHub 사용자명> --apply
```

여러 번 실행해도 안전하고, 이미 소유자가 있는 데이터는 건드리지 않습니다.

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드와 실행 |
| `npm run lint` | ESLint |
| `npm test` | 단위·통합 테스트(Vitest). MongoDB는 `mongodb-memory-server`가 자동으로 띄우므로 따로 설치할 필요가 없습니다. 첫 실행 때 mongod 바이너리를 내려받을 수 있습니다. |
| `npm run test:e2e` | 브라우저 E2E(Playwright). 인메모리 MongoDB·**가짜 GitHub 서버**·프로덕션 빌드로 앱을 띄워 로그인부터 전체 흐름을 검증합니다(실제 GitHub·실제 DB는 쓰지 않습니다). 처음 한 번 `npx playwright install chromium`이 필요합니다. |
| `npm run migrate:user-id` | 소유자 없는 기존 데이터를 지정한 GitHub 사용자에게 할당 (위 설명) |

## 구조

```
src/
  app/
    api/{goals,weeks,todos,me}/…     REST API (Route Handlers)
    auth/github, auth/github/callback, auth/logout    GitHub OAuth 로그인·로그아웃
  lib/
    auth/           GitHub 클라이언트, 사용자·세션 저장소, 쿠키·출처 검사
    schemas.ts      zod 입력 스키마, 상태 값
    progress.ts     진행률 계산 (순수 함수)
    repo/           MongoDB 접근 (목표·주간·할 일) — 모든 함수가 userId 범위로 동작
    db.ts           MongoClient 싱글턴과 인덱스
    api.ts          Route Handler 공통 처리 (로그인 확인, 오류 변환)
    board-state.ts  보드 컬럼 분류와 낙관적 이동 계산
    client/         fetch 래퍼와 SWR 훅
  components/       화면 컴포넌트 (AuthGate가 로그인 여부로 화면을 가른다)
scripts/            E2E 서버, 가짜 GitHub 서버, 마이그레이션
tests/{unit,integration,e2e}/
```

## 인증 동작

- `GET /auth/github` → 일회성 `state`를 쿠키에 저장하고 GitHub 승인 화면으로 이동
- `GET /auth/github/callback` → `state`를 대조(다르면 400, 세션 미생성)하고 `code`를 토큰으로 교환해 **GitHub 사용자명·아바타(`avatar_url`)를 DB에 저장**한 뒤 세션을 만들어 `/`로 이동. GitHub 액세스 토큰은 저장하지 않고 곧바로 버립니다.
- `POST /auth/logout` → DB의 세션 문서를 **삭제**하고 쿠키를 만료시킵니다(이전 쿠키를 다시 보내도 401).
- `GET /api/me` → 로그인한 사용자(`id`, `username`, `avatarUrl`)만 반환, 아니면 401.
- 세션: 32바이트 무작위 토큰(DB에는 SHA-256 해시만 저장), 7일 후 만료(MongoDB TTL 인덱스가 자동 삭제). 쿠키는 `HttpOnly`·`SameSite=Lax`이고 https에서는 `Secure`가 붙습니다.
- 보호: `/api/goals`·`/api/weeks`·`/api/todos` 전체는 **로그인이 없으면 401**(본문 파싱·DB 조회 전에 확인)이고, 다른 사용자의 데이터는 존재 여부도 알 수 없게 **404**입니다. 상태를 바꾸는 요청은 `Origin`이 요청 호스트와 다르면 403입니다(CSRF 방어).

## API

| 경로 | 메서드 |
|---|---|
| `/api/me` | GET |
| `/api/goals`, `/api/goals/:id` | GET·POST / GET·PATCH·DELETE |
| `/api/weeks`, `/api/weeks/:id` | GET(`?goalId=`, 진행률 포함)·POST / GET·PATCH·DELETE |
| `/api/todos`, `/api/todos/:id` | GET(`?weekId=&date=`)·POST / GET·PATCH·DELETE |

오류는 `{ "error": "메시지" }` 형태이며, 로그인이 없으면 401, 입력 오류는 400(`issues` 포함), 대상이 없거나 남의 데이터면 404입니다.

## 동작 규칙과 한계

- **삭제는 연쇄 삭제**입니다. 목표를 지우면 하위 주간 계획과 할 일이, 주간 계획을 지우면 소속 할 일이 함께 삭제됩니다(화면에서 확인 후). 단독 MongoDB는 트랜잭션을 쓸 수 없어 하위 → 상위 순서로 지우며, 중간에 실패하면 다시 시도해 이어서 정리할 수 있습니다. 모든 삭제는 요청한 사용자의 데이터로만 제한됩니다.
- 카드를 다른 컬럼으로 옮기면 그 컬럼의 맨 아래에 놓입니다. 저장에 실패하면 원래 컬럼으로 되돌리고 오류를 보여줍니다.
- 주간 시작일은 월요일을 기본으로 제안하지만 직접 바꿀 수 있습니다.
- 키보드: 카드의 ⠿ 손잡이에서 Space로 잡고 방향키로 이웃 컬럼으로 옮긴 뒤 Space로 놓습니다. 카드의 상태 선택 상자로도 바꿀 수 있습니다.
- 리버스 프록시 뒤에서 운영하면 `Host` 또는 `X-Forwarded-Host`가 원래 접속 호스트로 전달되어야 합니다(출처 검사가 `Origin`과 비교합니다). https로 서비스한다면 프록시가 `X-Forwarded-Proto: https`를 넘겨야 세션 쿠키에 `Secure`가 붙습니다.
- **운영 배포 전 권고(현재 구현에서 알려진 한계)**
  - `GITHUB_OAUTH_URL`/`GITHUB_API_URL`은 테스트용이므로 운영 환경에는 설정하지 마세요(설정하면 그 주소의 서버를 GitHub로 믿습니다).
  - 로그인 시도 횟수 제한(레이트 리미팅), PKCE, CSP·`frame-ancestors` 헤더는 구현하지 않았습니다.
  - 재로그인해도 이전 세션은 만료(7일)나 로그아웃 때까지 유효합니다.
  - 같은 호스트의 형제 서브도메인을 다른 사람이 쓰는 배포라면 `__Host-` 접두 쿠키로 바꾸는 것이 안전합니다.
  - `npm audit`에는 개발 도구(eslint 계열)의 의존성 경고가 있고, 운영 의존성(`--omit=dev`)에는 없습니다.
- **미구현(P1)**: 1년 목표 진행률 집계, 일일/주간/1년 보기 전환, 계층 트리 보기, 같은 컬럼 안 순서 변경. `order` 필드는 이를 위해 이미 저장하고 있습니다.
