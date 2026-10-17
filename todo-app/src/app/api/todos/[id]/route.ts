import { handleAuthed, parseId, type IdContext } from '@/lib/api';
import { getDb } from '@/lib/db';
import { deleteTodo, getTodo, updateTodo } from '@/lib/repo/todos';
import { todoUpdateSchema } from '@/lib/schemas';

export function GET(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => Response.json(await getTodo(await getDb(), user.id, parseId((await params).id))));
}

export function PATCH(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => {
    const id = parseId((await params).id);
    const input = todoUpdateSchema.parse(await request.json());
    return Response.json(await updateTodo(await getDb(), user.id, id, input));
  });
}

export function DELETE(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => {
    await deleteTodo(await getDb(), user.id, parseId((await params).id));
    return new Response(null, { status: 204 });
  });
}
