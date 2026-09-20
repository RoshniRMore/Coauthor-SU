import { embedQuery } from '../../../lib/embeddings.mjs';
import { idx, queryMatches } from '../../../lib/data';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  let text: unknown;
  try { ({ text } = await request.json()); } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
    return Response.json({ error: 'Text must contain between 1 and 20,000 characters.' }, { status: 400 });
  }
  const result = await embedQuery(text, idx.meta.embedding_model, idx.embedding);
  return Response.json({ ...result, ...queryMatches(result.vector, result.fallback) });
}
