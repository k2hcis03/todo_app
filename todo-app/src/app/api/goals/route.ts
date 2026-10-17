import { handleAuthed } from '@/lib/api';
import { getDb } from '@/lib/db';
import { createGoal, listGoals } from '@/lib/repo/goals';
import { goalInputSchema } from '@/lib/schemas';

export function GET(request: Request) {
  return handleAuthed(request, async (user) => Response.json(await listGoals(await getDb(), user.id)));
}

export function POST(request: Request) {
  return handleAuthed(request, async (user) => {
    const input = goalInputSchema.parse(await request.json());
    return Response.json(await createGoal(await getDb(), user.id, input), { status: 201 });
  });
}
