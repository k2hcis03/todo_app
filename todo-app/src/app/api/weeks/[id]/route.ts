import { handleAuthed, parseId, type IdContext } from '@/lib/api';
import { getDb } from '@/lib/db';
import { deleteWeek, getWeek, updateWeek } from '@/lib/repo/weeks';
import { weekUpdateSchema } from '@/lib/schemas';

export function GET(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => Response.json(await getWeek(await getDb(), user.id, parseId((await params).id))));
}

export function PATCH(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => {
    const id = parseId((await params).id);
    const input = weekUpdateSchema.parse(await request.json());
    return Response.json(await updateWeek(await getDb(), user.id, id, input));
  });
}

export function DELETE(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => Response.json(await deleteWeek(await getDb(), user.id, parseId((await params).id))));
}
