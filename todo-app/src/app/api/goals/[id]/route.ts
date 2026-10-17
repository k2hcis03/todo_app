import { handleAuthed, parseId, type IdContext } from '@/lib/api';
import { getDb } from '@/lib/db';
import { deleteGoal, getGoal, updateGoal } from '@/lib/repo/goals';
import { goalUpdateSchema } from '@/lib/schemas';

export function GET(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => Response.json(await getGoal(await getDb(), user.id, parseId((await params).id))));
}

export function PATCH(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => {
    const id = parseId((await params).id);
    const input = goalUpdateSchema.parse(await request.json());
    return Response.json(await updateGoal(await getDb(), user.id, id, input));
  });
}

export function DELETE(request: Request, { params }: IdContext) {
  return handleAuthed(request, async (user) => Response.json(await deleteGoal(await getDb(), user.id, parseId((await params).id))));
}
