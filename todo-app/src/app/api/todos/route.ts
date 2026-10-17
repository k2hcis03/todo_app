import { handleAuthed, optionalQuery } from '@/lib/api';
import { getDb } from '@/lib/db';
import { createTodo, listTodos } from '@/lib/repo/todos';
import { dateString, objectIdString, todoCreateSchema } from '@/lib/schemas';

/** GET /api/todos?weekId=<id>&date=YYYY-MM-DD — 둘 다 선택, order 오름차순 */
export function GET(request: Request) {
  return handleAuthed(request, async (user) => {
    const filter = {
      weekId: optionalQuery(request, 'weekId', objectIdString),
      date: optionalQuery(request, 'date', dateString),
    };
    return Response.json(await listTodos(await getDb(), user.id, filter));
  });
}

export function POST(request: Request) {
  return handleAuthed(request, async (user) => {
    const input = todoCreateSchema.parse(await request.json());
    return Response.json(await createTodo(await getDb(), user.id, input), { status: 201 });
  });
}
