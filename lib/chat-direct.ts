import type { ProviderConfig } from './providers';
import { SYSTEM_PROMPT } from './providers';

// Direct browser→provider call. Used as fallback when /api/chat is unavailable
// (static export / Tauri frontendDist has no Next server) and as primary in desktop.
// `system` overrides the default SYSTEM_PROMPT (used by the part generator).
// `attachment` sends an image or PDF (Anthropic only for PDF) with the message.
export type ChatAttachment = {
  kind: 'image' | 'document';
  /** Real MIME type, e.g. image/jpeg or application/pdf. */
  mediaType: string;
  /** Base64 payload without the `data:` prefix. */
  data: string;
};

export async function chatDirect(
  provider: ProviderConfig,
  userPrompt: string,
  system = SYSTEM_PROMPT,
  attachment?: ChatAttachment,
): Promise<string> {
  if (provider.kind === 'anthropic') {
    const content: any[] = [{ type: 'text', text: userPrompt }];
    if (attachment?.kind === 'image')
      content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } });
    else if (attachment?.kind === 'document')
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.data } });
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
        system,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j?.content?.map((b: any) => b.text ?? '').join('\n') ?? JSON.stringify(j);
  }
  const url = `${(provider.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`;
  const content: any[] = [{ type: 'text', text: userPrompt }];
  if (attachment?.kind === 'image')
    content.push({ type: 'image_url', image_url: { url: `data:${attachment.mediaType};base64,${attachment.data}` } });
  else if (attachment?.kind === 'document')
    throw new Error('PDF attachments need the Anthropic provider — attach a pinout image or paste the datasheet text instead.');
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
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Provider ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? JSON.stringify(j);
}
