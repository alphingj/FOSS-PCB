import { NextRequest, NextResponse } from 'next/server';
import { CatalogError, cachedCatalogSearch, type CatalogCredentials, type CatalogProvider } from '../../../lib/catalog';

// Web/dev transport for the live distributor catalog. The desktop app talks to
// the distributors directly (Tauri HTTP plugin) so keys never leave the machine;
// this proxy exists for `npm run dev` / `next start`, where the browser can't
// call DigiKey/Mouser because of CORS.
//
// Keys arrive per request and are never persisted or logged. Only the three
// known providers are reachable, and request bodies are size/length capped.

export const runtime = 'nodejs';

const PROVIDERS: CatalogProvider[] = ['digikey', 'mouser', 'lcsc'];

export async function POST(req: NextRequest) {
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 20_000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body?.provider as CatalogProvider;
  if (!PROVIDERS.includes(provider))
    return NextResponse.json({ error: `Unknown provider "${String(body?.provider)}".` }, { status: 400 });
  if (typeof body?.query !== 'string') return NextResponse.json({ error: 'Missing search query.' }, { status: 400 });
  if (typeof body?.limit !== 'undefined' && typeof body.limit !== 'number')
    return NextResponse.json({ error: 'limit must be a number.' }, { status: 400 });
  if (typeof body?.offset !== 'undefined' && typeof body.offset !== 'number')
    return NextResponse.json({ error: 'offset must be a number.' }, { status: 400 });

  const creds = body?.credentials;
  if (creds !== undefined && (typeof creds !== 'object' || creds === null))
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 400 });

  try {
    const result = await cachedCatalogSearch(
      { provider, query: body.query, limit: body.limit, offset: body.offset },
      (creds ?? {}) as CatalogCredentials,
    );
    return NextResponse.json(result);
  } catch (e: any) {
    const status = e instanceof CatalogError ? (e.status ?? 400) : 500;
    return NextResponse.json({ error: e?.message ?? 'Catalog search failed.' }, { status });
  }
}
