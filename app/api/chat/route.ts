import { NextRequest, NextResponse } from 'next/server';

// Dumb proxy: frontend sends key per request, we forward. Never persist keys.
// SSRF guard: only https hosts, no private/loopback/link-local/metadata IPs,
// http allowed solely for loopback dev servers (Ollama etc).
function hostAllowed(baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return false;
  }
  if (!['https:', 'http:'].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (u.protocol === 'http:') {
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  // IPv4 literal checks
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n < 0 || n > 255)) return false;
    if (o[0] === 10 || o[0] === 127) return false;
    if (o[0] === 169 && o[1] === 254) return false; // cloud metadata
    if (o[0] === 192 && o[1] === 168) return false;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
    if (o[0] === 0 || o[0] >= 224) return false;
    return true;
  }
  if (h.includes(':')) return false; // no literal IPv6
  if (h === 'metadata.google.internal' || h === 'metadata.google') return false;
  return true;
}

async function timedFetch(url: string, init: RequestInit, ms = 90000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { kind, apiKey, baseUrl, model, messages, extraHeaders } = await req.json();
    if (!apiKey || !model) return NextResponse.json({ error: 'Missing apiKey/model' }, { status: 400 });
    if (typeof apiKey !== 'string' || typeof model !== 'string' || apiKey.length > 500 || model.length > 200)
      return NextResponse.json({ error: 'Invalid apiKey/model' }, { status: 400 });

    if (kind === 'anthropic') {
      const r = await timedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 6000, temperature: 0.2, system: messages[0]?.content ?? '', messages: messages.slice(1) }),
      });
      if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}` }, { status: 502 });
      const j = await r.json();
      const text = j?.content?.map((b: any) => b.text ?? '').join('\n') ?? JSON.stringify(j);
      return NextResponse.json({ text });
    }

    // openrouter + custom (OpenAI-compatible)
    const base = (baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    if (!hostAllowed(base)) return NextResponse.json({ error: 'Blocked baseUrl (private/local hosts not allowed except loopback http)' }, { status: 400 });
    const url = `${base}/chat/completions`;
    const { Authorization, authorization, ...safeExtra } = (extraHeaders ?? {}) as Record<string, string>;
    void Authorization;
    void authorization;
    const r = await timedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': req.headers.get('referer') ?? 'http://localhost:3000',
        'X-Title': 'FOSS-PCB',
        ...safeExtra,
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    });
    if (!r.ok) return NextResponse.json({ error: `Provider ${r.status}: ${(await r.text()).slice(0, 300)}` }, { status: 502 });
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? JSON.stringify(j);
    return NextResponse.json({ text });
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Provider timed out after 90s' : e.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
