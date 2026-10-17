import { handleAuthed, optionalQuery } from '@/lib/api';
import { getDb } from '@/lib/db';
import { createWeek, listWeeks } from '@/lib/repo/weeks';
import { objectIdString, weekInputSchema } from '@/lib/schemas';

export function GET(request: Request) {
  return handleAuthed(request, async (user) => {
    const goalId = optionalQuery(request, 'goalId', objectIdString);
    return Response.json(await listWeeks(await getDb(), user.id, { goalId }));
  });
}

export function POST(request: Request) {
  return handleAuthed(request, async (user) => {
    const input = weekInputSchema.parse(await request.json());
    return Response.json(await createWeek(await getDb(), user.id, input), { status: 201 });
  });
}
