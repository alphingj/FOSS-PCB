import type { ProviderConfig } from './providers';
import { SYSTEM_PROMPT } from './providers';

// Direct browser→provider call. Used as fallback when /api/chat is unavailable
// (static export / Tauri frontendDist has no Next server) and as primary in desktop.
export async function chatDirect(provider: ProviderConfig, userPrompt: string): Promise<string> {
  if (provider.kind === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j?.content?.map((b: any) => b.text ?? '').join('\n') ?? JSON.stringify(j);
  }
  const url = `${(provider.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'FOSS-PCB',
      ...(provider.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Provider ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? JSON.stringify(j);
}
