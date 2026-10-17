import { handle } from '@/lib/api';
import { requireUser } from '@/lib/auth/request';

/** GET /api/me — 로그인한 사용자(id, username, avatarUrl)만 돌려준다. 로그인하지 않았으면 401. */
export function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    return Response.json(user, { headers: { 'Cache-Control': 'no-store' } });
  });
}
