# 할 일 관리 앱 구현 계획 (Next.js + TypeScript + MongoDB)

- 상태: **pending approval** (실행 승인 전, 코드 변경 없음)
- 근거 문서: `docs/prd.md`
- 현재 프로젝트 상태: 그린필드. 소스 없음 (`docs/prd.md`, `.gitignore`, `.ignore`, `graft/`, `.omc/`만 존재)
- 환경 확인 결과: Node v24.14.0, npm 11.9.0 사용 가능. **`mongod`, `mongosh`, `docker`는 설치되어 있지 않고 `MONGODB_URI`도 없음** (위험 R1)

## 1. 요구사항 요약

1년 목표 → 주간 계획 → 일일 할 일(N:1, N:1)로 연결해 관리한다. 보드(todo/doing/done)에서 드래그 앤 드롭으로 상태를 바꾸면 즉시 DB에 저장한다. 주간 진행률은 `done / 연결된 전체 × 100`(전체 0개면 0%)으로 자동 계산한다.

## 2. 기술 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 프레임워크 | Next.js (App Router) + TypeScript strict | 사용자 지정 |
| DB 접근 | 공식 `mongodb` 드라이버 + `zod` 검증 | 컬렉션 3개로 단순, ODM 불필요 |
| 백엔드 | **별도 서버 없음.** Next.js API Routes(App Router의 Route Handlers, `app/api/**/route.ts`)가 MongoDB에 직접 연결하는 REST API | 사용자 지정. 프런트와 한 프로젝트·한 배포 단위, 낙관적 업데이트와 E2E 테스트가 쉬움 |
| 드래그 앤 드롭 | `@dnd-kit/core` + `@dnd-kit/sortable` | P0 컬럼 이동과 P1 순서 변경을 한 라이브러리로 처리 |
| 서버 상태 | SWR 또는 TanStack Query 중 하나 (SWR 기본) | 낙관적 업데이트와 롤백 |
| 테스트 | Vitest(단위) + `mongodb-memory-server`(통합) + Playwright(E2E) | 로컬 MongoDB 설치 없이 통합 테스트 가능 |
| 인증 | 범위 밖 (개인 사용자 대상, 단일 사용자 가정) | PRD에 인증 요구 없음 |
| 개발용 DB | **미정**: MongoDB Atlas 무료(M0) 또는 로컬 설치 (8절 확인 필요) | 현재 PC에 MongoDB 없음 |

> 버전은 실행 단계에서 `create-next-app`과 `npm view`로 확인해 고정한다. 계획 시점에 임의로 단정하지 않는다.

## 3. 데이터 모델 (컬렉션 3개)

```ts
type Status = 'todo' | 'doing' | 'done';

// goals:  { _id, title, year, createdAt, updatedAt }
// weeks:  { _id, title, weekStart: 'YYYY-MM-DD', goalId: ObjectId, createdAt, updatedAt }   // N:1 → goals
// todos:  { _id, title, date: 'YYYY-MM-DD', status: Status, weekId: ObjectId, order: number, createdAt, updatedAt } // N:1 → weeks
```

- **인덱스**: `weeks.goalId`, `todos.weekId`, `todos.status`, `todos.date`
- **진행률은 저장하지 않는다.** 조회 시 계산하며, 주간 목록은 `weeks`를 기준으로 `todos`를 `$lookup`(또는 `todos` `$group` 결과를 `weeks`와 합침)하는 집계 한 번으로 구한다 (N+1 방지). 할 일이 없는 주간도 목록에 포함되어 `total: 0, progress: 0`으로 나와야 한다 (`todos`만 `$group`하면 빈 주간이 누락됨).
- `weekProgress`는 **0~100 범위의 소수 그대로**(예: 1/3 → `33.333…`) 반환하고, 화면에서만 `Math.round`로 정수 표시한다.
- `order`는 컬럼 내 정렬용 `number`(fractional index)다. 새 할 일은 `Date.now()`로 생성되어 항상 컬럼 맨 아래에 놓인다. P1에서 두 카드 사이로 옮길 때는 앞뒤 카드 `order`의 중간값을 쓴다. P0에서는 컬럼 내 순서 변경 UI가 없으므로 정렬만 `order` 오름차순으로 한다.
- 날짜는 `YYYY-MM-DD` 문자열로 저장해 시간대 변환 오류를 피한다.

## 4. 디렉터리 구조 (예정)

```
src/
  app/
    page.tsx                 # 보드 + 주간/목표 패널
    api/goals/route.ts, api/goals/[id]/route.ts
    api/weeks/route.ts,  api/weeks/[id]/route.ts
    api/todos/route.ts,  api/todos/[id]/route.ts
  lib/db.ts                  # MongoClient 싱글턴 (dev HMR에서 global 캐시)
  lib/progress.ts            # 순수 함수: weekProgress, (P1) goalProgress
  lib/schemas.ts             # zod 스키마, Status 타입
  lib/repo/{goals,weeks,todos}.ts
  components/{Board,Column,TodoCard,WeekList,GoalList,forms}/
tests/{unit,integration,e2e}/
.env.example                 # MONGODB_URI, MONGODB_DB (실제 값은 .env.local, 커밋 금지)
```

## 5. 구현 단계

### 단계 0. 환경 준비
- DB 제공 방식 확정 후 `MONGODB_URI`를 `.env.local`에 설정 (`.gitignore`에 `.env*.local` 포함 확인)
- 완료 기준: 앱 서버에서 `db.command({ ping: 1 })` 성공

### 단계 1. 프로젝트 초기화
- `create-next-app`(TypeScript, App Router, ESLint), Vitest, Playwright, 의존성 설치
- 완료 기준: `npm run dev`, `npm run build`, `npm test`, `npm run lint` 성공

### 단계 2. 도메인 로직 (테스트 우선)
- `lib/progress.ts`, `lib/schemas.ts`: 새 할 일 기본 상태 `todo`, 진행률 계산
- 완료 기준: 수용 기준 1~4 단위 테스트 통과

### 단계 3. DB 계층
- `lib/db.ts`(싱글턴, 인덱스 생성), `lib/repo/*`
- 완료 기준: `mongodb-memory-server` 통합 테스트로 CRUD와 인덱스 확인

### 단계 4. API (Route Handlers)
- goals / weeks / todos CRUD, `GET /api/weeks`는 진행률 포함 응답
- 입력은 zod로 검증하고 잘못된 `ObjectId`나 존재하지 않는 `weekId`는 400/404 반환
- `GET /api/todos?weekId=<id>`로 주간별 조회, `date=YYYY-MM-DD`를 함께 주면 일일 목록 (둘 다 선택 파라미터, 정렬은 `order` 오름차순)
- `PATCH /api/todos/[id]`로 `status`, `weekId`, `title`, `date` 수정
- 완료 기준: 수용 기준 5~8 통합 테스트 통과

### 단계 5. 목표 / 주간 계획 UI (P0)
- 사용자 흐름 1~2번 수행 가능

### 단계 6. 할 일 CRUD UI (P0)
- 생성(제목, 날짜, 주간 계획 필수), 일일 목록, 수정, 삭제. 흐름 3번 수행 가능

### 단계 7. 보드 + 드래그 앤 드롭 (P0)
- **보드 범위(P0 기본값)**: 사용자가 선택한 주간 계획의 할 일 전체(`GET /api/todos?weekId=`)를 todo/doing/done 3컬럼에 표시하고, 날짜는 카드에 표시한다. 선택한 주간이 없으면 안내 문구만 보여준다. "일일 할 일 목록"은 같은 주간에서 날짜 필터(`date=`)로 제공한다.
- 드롭 시 낙관적 업데이트 후 `PATCH`, 실패하면 롤백하고 오류 표시
- 키보드 센서 활성화. 흐름 4~5번 수행 가능

### 단계 8. 주간 진행률 표시 (P0)
- 주간 카드에 진행률 바 표시, 할 일 생성·삭제·상태 변경 후 재조회(또는 낙관적 재계산). 흐름 6번 수행 가능

### 단계 9. P1 (P0 완료 후 별도 승인)
1. 1년 목표 진행률 = 연결된 주간 계획 진행률 집계 (`$lookup` 또는 앱 레벨 집계)
2. 일일/주간/1년 보기 전환
3. 계층 트리 보기
4. 같은 컬럼 내 순서 변경 (`order` 갱신)

## 6. 수용 기준 (테스트 가능)

| # | 기준 | 검증 |
|---|---|---|
| 1 | 할 일 3개 중 1개 done이면 `weekProgress`가 `33.333…`(소수 그대로)을 반환하고, 화면 표시는 `33%` | 단위 + 컴포넌트 |
| 2 | 연결된 할 일 0개면 0% (0으로 나누기 없음). `GET /api/weeks`에서 할 일 없는 주간도 `total: 0, progress: 0`으로 목록에 포함 | 단위 + 통합 |
| 3 | 할 일을 삭제하면 분모·분자가 함께 갱신 | 단위/통합 |
| 4 | 새 할 일의 기본 상태는 `todo` | 단위 |
| 5 | `POST /api/todos`에 존재하지 않는 `weekId`를 보내면 404, 제목 빈 값이면 400 | 통합 |
| 6 | `PATCH /api/todos/:id {status:'doing'}` 후 `GET`에서 `doing`으로 조회 | 통합 |
| 7 | 할 일의 `weekId`를 바꾸면 이전·새 주간의 진행률이 모두 갱신 | 통합 |
| 8 | (기본안: 연쇄 삭제) 하위 주간 2개·할 일 3개가 있는 목표를 삭제하면 `weeks`·`todos`에서 해당 문서가 0건이 된다. 정책이 "차단"으로 바뀌면 409 응답과 문서 유지로 기준을 교체한다 | 통합 |
| 8-1 | 새 할 일은 같은 컬럼의 기존 카드보다 `order`가 커서 맨 아래에 놓인다 | 통합 |
| 8-2 | `GET /api/todos?weekId=A`는 주간 A의 할 일만 `order` 오름차순으로 반환 | 통합 |
| 9 | 카드를 doing 컬럼으로 드롭 → 새로고침 후에도 doing | E2E |
| 10 | 드롭 시 서버가 실패하면 카드가 원래 컬럼으로 복귀 | E2E (라우트 모킹) |
| 11 | `npm run build`, `npm test`, `npm run lint` 오류 0 | CLI |

## 7. 위험과 대응

| ID | 위험 | 대응 |
|---|---|---|
| R1 | 이 PC에 MongoDB·Docker가 없어 개발 DB가 없음 | 단계 0에서 Atlas M0 또는 로컬 설치 중 선택. 테스트는 `mongodb-memory-server`로 DB 없이 실행 |
| R2 | 연결 문자열 등 비밀 값 유출 | `.env.local`만 사용, `.env.example`엔 자리 표시자만 두고 커밋 금지, `.gitignore` 확인 |
| R3 | 상위 항목 삭제 시 고아 데이터. 단독 MongoDB는 트랜잭션 불가(레플리카 셋 필요) | 하위 → 상위 순으로 삭제, 삭제 전 개수 확인 대화상자. 기본안은 연쇄 삭제 (사용자 결정 필요) |
| R4 | 진행률 저장 시 값 불일치 | 저장하지 않고 조회 시 계산. 수용 기준 7로 검증 |
| R5 | dev 서버 HMR로 MongoClient가 중복 생성되어 연결 고갈 | `global` 캐시 싱글턴 |
| R6 | 드래그 후 저장 실패로 UI·DB 불일치 | 낙관적 업데이트 + 롤백, 수용 기준 10 |
| R7 | `ObjectId` 문자열 처리 실수 (잘못된 id 500 오류) | zod에서 `ObjectId.isValid` 검증 후 변환 |
| R8 | "주간" 기준 모호 | `weekStart` 저장, 월요일 시작 기본 (확인 필요) |
| R9 | Next.js 최신 버전의 API 변경 (async params 등) | 실행 단계에서 설치된 버전의 공식 문서 확인 후 구현 |

## 8. 사용자 확인이 필요한 사항

1. **개발용 MongoDB**: Atlas 무료 클러스터 / 로컬 설치(Community) 중 무엇을 쓸지. 현재 PC에 없음
2. 목표·주간 삭제 정책: 연쇄 삭제(기본안) / 하위가 있으면 차단
3. 주간 시작 요일: 월요일 기준 가정
4. P1을 P0과 함께 진행할지, P0 완료 후 별도로 할지
5. 인증 없는 단일 사용자 앱으로 충분한지

## 9. 검증 단계

1. `npm test` — 단위 + 통합(mongodb-memory-server)
2. `npm run build && npm run lint`
3. Playwright E2E: 목표 → 주간 → 할 일 생성 → 드래그 → 진행률 확인 → 새로고침 후 유지 (사용자 흐름 1~6)
4. 수동 확인: 실제 MongoDB에 연결한 상태에서 드래그와 키보드 이동
