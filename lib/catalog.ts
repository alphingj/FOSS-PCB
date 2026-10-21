// Live distributor catalog: search DigiKey and Mouser with the user's own API
// credentials, and surface LCSC as verified deep links (LCSC publishes no public
// product API — see CATALOG_PROVIDERS below, we never guess results for it).
//
// Endpoints and payload shapes come from the vendors' own documentation:
//   DigiKey Product Information v4: POST /products/v4/search/keyword (OAuth2
//     client-credentials token from /v1/oauth2/token, X-DIGIKEY-Client-Id header)
//   Mouser Search API v1: POST /api/v1/search/keyword?apiKey=… with the
//     SearchByKeywordRequest wrapper (api.mouser.com/api/docs/V1 swagger)
// Anything we cannot map is left undefined rather than guessed, and a
// distributor error is surfaced verbatim.
//
// Keys live only in the caller's browser/app storage; they are sent straight to
// the distributor (desktop) or through the local /api/catalog proxy (web dev).

import { isTauri } from './tauri-bridge';

export type CatalogProvider = 'digikey' | 'mouser' | 'lcsc';

export interface CatalogCredentials {
  digikey?: { clientId: string; clientSecret: string };
  mouser?: { apiKey: string };
}

export interface CatalogQuery {
  provider: CatalogProvider;
  query: string;
  /** 1..50, default 25. */
  limit?: number;
  /** Paging offset, default 0. */
  offset?: number;
}

export interface PriceBreak {
  qty: number;
  price: number;
}

export interface CatalogPart {
  provider: CatalogProvider;
  /** Manufacturer part number (what goes on the BOM). */
  mpn: string;
  manufacturer: string;
  description: string;
  /** Distributor's own ordering code (DigiKey PN / Mouser PN). Empty for LCSC. */
  distributorPart: string;
  /** Package text as the distributor reports it — NOT a KiCad footprint name. */
  package?: string;
  /** Units in stock, when the value is unambiguous (never estimated). */
  stock?: number;
  /** Raw availability string, always safe to display. */
  stockText?: string;
  /** Lowest-quantity unit price in `currency`, when parseable. */
  unitPrice?: number;
  currency?: string;
  priceBreaks?: PriceBreak[];
  datasheetUrl?: string;
  productUrl?: string;
}

export interface CatalogResult {
  provider: CatalogProvider;
  parts: CatalogPart[];
  /** Matches reported by the distributor, when it reports a count. */
  total?: number;
  note?: string;
}

export const CATALOG_TIMEOUT_MS = 15000;
export const CATALOG_MAX_LIMIT = 50;
export const CATALOG_DEFAULT_LIMIT = 25;
export const CATALOG_MAX_QUERY = 120;
/** Successful searches are reused for this long. Distributor stock/prices move,
 *  so this stays short; errors are never cached. */
export const CATALOG_CACHE_TTL_MS = 5 * 60_000;
export const CATALOG_CACHE_MAX = 60;

export const DIGIKEY_TOKEN_URL = 'https://api.digikey.com/v1/oauth2/token';
export const DIGIKEY_SEARCH_URL = 'https://api.digikey.com/products/v4/search/keyword';
export const MOUSER_SEARCH_URL = 'https://api.mouser.com/api/v1/search/keyword';

export class CatalogError extends Error {
  status?: number;
  constructor(message: string, opts?: { status?: number }) {
    super(message);
    this.name = 'CatalogError';
    this.status = opts?.status;
  }
}

/** Provider metadata for settings UI: which credentials are needed, where to get them. */
export const CATALOG_PROVIDERS: {
  id: CatalogProvider;
  label: string;
  fields: ('apiKey' | 'clientId' | 'clientSecret')[];
  docs: string;
  note: string;
}[] = [
  {
    id: 'mouser',
    label: 'Mouser',
    fields: ['apiKey'],
    docs: 'https://www.mouser.com/api-search/',
    note: 'Search API v1 — 30 calls/min, 1,000/day. Prices are in your Mouser account currency.',
  },
  {
    id: 'digikey',
    label: 'DigiKey',
    fields: ['clientId', 'clientSecret'],
    docs: 'https://developer.digikey.com/products/product-information-v4/productsearch/keywordsearch',
    note: 'Product Information v4, OAuth2 client credentials — 120 calls/min. Prices in USD.',
  },
  {
    id: 'lcsc',
    label: 'LCSC',
    fields: [],
    docs: 'https://www.lcsc.com/search',
    note: 'No public search API. FOSS-PCB opens LCSC search and C-number pages instead of guessing results.',
  },
];

// ---------------------------------------------------------------- validation

export function normalizeQuery(raw: string): string {
  const q = String(raw ?? '').trim();
  if (!q) throw new CatalogError('Enter a part number or keyword to search.');
  if (q.length > CATALOG_MAX_QUERY) throw new CatalogError(`Search is limited to ${CATALOG_MAX_QUERY} characters.`);
  return q;
}

export function normalizeLimit(n?: number): number {
  if (n === undefined || n === null) return CATALOG_DEFAULT_LIMIT;
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) throw new CatalogError('Result limit must be a positive number.');
  return Math.min(v, CATALOG_MAX_LIMIT);
}

export function normalizeOffset(n?: number): number {
  if (n === undefined || n === null) return 0;
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) throw new CatalogError('Offset must be zero or greater.');
  return Math.min(v, 5000);
}

// ------------------------------------------------------------------- parsing

/** Parse a price string/number. Ambiguous formats ("1,23" without a dot decimal
 *  separator) return undefined instead of a wrong number. */
export function parsePrice(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s/g, '');
  if (!s) return undefined;
  const core =
    s.match(/^[^\d]*(\d{1,3}(?:,\d{3})+(?:\.\d+)?)[^\d]*$/)?.[1] ??
    s.match(/^[^\d]*(\d+(?:\.\d+)?)[^\d]*$/)?.[1];
  if (!core) return undefined;
  const n = Number(core.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** "1,234" → 1234; "1,234 In Stock" → 1234; "Non-Stock" → text only. */
export function parseStockText(v: unknown): { count?: number; text?: string } {
  if (typeof v !== 'string') return {};
  const text = v.trim();
  if (!text) return {};
  const m = text.replace(/\s+/g, ' ').match(/^([\d,]{1,15})(?: (?:in stock|available))?$/i);
  const count = m ? Number(m[1].replace(/,/g, '')) : undefined;
  return { count: count !== undefined && Number.isFinite(count) ? count : undefined, text };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** DigiKey v4 KeywordSearch request body (see KeywordSearch docs). */
export function digikeySearchBody(query: string, limit: number, offset: number) {
  return {
    Keywords: query,
    Limit: limit,
    Offset: offset,
    FilterOptionsRequest: { SearchOptions: ['InStock'] },
    SortOptions: { Field: 'None', SortOrder: 'Ascending' },
  };
}

/** Mouser v1 keyword request body — wrapper name is SearchByKeywordRequest. */
export function mouserSearchBody(query: string, limit: number, offset: number) {
  return {
    SearchByKeywordRequest: {
      keyword: query,
      records: limit,
      startingRecord: offset,
      searchOptions: 'InStock',
    },
  };
}

export function mouserSearchEndpoint(apiKey: string): string {
  return `${MOUSER_SEARCH_URL}?apiKey=${encodeURIComponent(apiKey)}`;
}

/** Normalize a DigiKey Products[] response. */
export function parseDigiKeyProducts(json: any, currency = 'USD'): CatalogResult {
  const products = Array.isArray(json?.Products) ? json.Products : [];
  const parts: CatalogPart[] = [];
  for (const p of products) {
    const mpn = str(p?.ManufacturerProductNumber);
    if (!mpn) continue;
    const variations = Array.isArray(p?.ProductVariations) ? p.ProductVariations : [];
    const primary = variations[0] ?? {};
    const breaks: PriceBreak[] = (Array.isArray(primary?.StandardPricing) ? primary.StandardPricing : [])
      .map((b: any) => ({ qty: Number(b?.BreakQuantity), price: Number(b?.UnitPrice) }))
      .filter((b: PriceBreak) => Number.isFinite(b.qty) && Number.isFinite(b.price) && b.qty > 0);
    breaks.sort((a: PriceBreak, b: PriceBreak) => a.qty - b.qty);
    const stock =
      typeof p?.QuantityAvailable === 'number'
        ? p.QuantityAvailable
        : typeof primary?.QuantityAvailableforPackageType === 'number'
          ? primary.QuantityAvailableforPackageType
          : undefined;
    const unitPrice = typeof p?.UnitPrice === 'number' && Number.isFinite(p.UnitPrice) ? p.UnitPrice : breaks[0]?.price;
    parts.push({
      provider: 'digikey',
      mpn,
      manufacturer: str(p?.Manufacturer?.Name),
      description: str(p?.Description?.ProductDescription) || str(p?.Description?.DetailedDescription),
      distributorPart: str(primary?.DigiKeyProductNumber),
      package: str(primary?.PackageType?.Name) || undefined,
      stock,
      stockText: typeof stock === 'number' ? `${stock.toLocaleString('en-US')} in stock` : undefined,
      unitPrice,
      currency: unitPrice !== undefined ? currency : undefined,
      priceBreaks: breaks.length ? breaks : undefined,
      datasheetUrl: str(p?.DatasheetUrl) || undefined,
      productUrl: str(p?.ProductUrl) || undefined,
    });
  }
  const total = typeof json?.ProductsCount === 'number' ? json.ProductsCount : undefined;
  return { provider: 'digikey', parts, total, note: 'Prices from DigiKey Product Information v4 (USD).' };
}

/** Normalize a Mouser SearchResponseRoot. Throws when Mouser reports Errors. */
export function parseMouserParts(json: any): CatalogResult {
  const errors = Array.isArray(json?.Errors) ? json.Errors : [];
  if (errors.length) {
    const msg = errors
      .map((e: any) => [str(e?.Message), str(e?.PropertyName)].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('; ');
    throw new CatalogError(`Mouser: ${msg || 'request rejected'}`, { status: 400 });
  }
  const rawParts = Array.isArray(json?.SearchResults?.Parts) ? json.SearchResults.Parts : [];
  const parts: CatalogPart[] = [];
  for (const p of rawParts) {
    const mpn = str(p?.ManufacturerPartNumber) || str(p?.MouserPartNumber);
    if (!mpn) continue;
    const breaks: PriceBreak[] = (Array.isArray(p?.PriceBreaks) ? p.PriceBreaks : [])
      .map((b: any) => ({ qty: Number(b?.Quantity), price: parsePrice(b?.Price) }))
      .filter((b: PriceBreak): b is PriceBreak => Number.isFinite(b.qty) && b.qty > 0 && typeof b.price === 'number');
    breaks.sort((a, b) => a.qty - b.qty);
    const currency = str((Array.isArray(p?.PriceBreaks) ? p.PriceBreaks : []).find((b: any) => str(b?.Currency))?.Currency);
    const inStock = parseStockText(p?.AvailabilityInStock);
    const availability = parseStockText(p?.Availability);
    const stock = inStock.count ?? availability.count;
    const attrs = Array.isArray(p?.ProductAttributes) ? p.ProductAttributes : [];
    const pkg = str(attrs.find((a: any) => /package|packaging|case|mounting/i.test(str(a?.AttributeName)))?.AttributeValue);
    parts.push({
      provider: 'mouser',
      mpn,
      manufacturer: str(p?.Manufacturer) || str(p?.ActualMfrName),
      description: str(p?.Description),
      distributorPart: str(p?.MouserPartNumber),
      package: pkg || undefined,
      stock,
      stockText: availability.text || inStock.text,
      unitPrice: breaks[0]?.price,
      currency: breaks.length && currency ? currency : undefined,
      priceBreaks: breaks.length ? breaks : undefined,
      datasheetUrl: str(p?.DataSheetUrl) || undefined,
      productUrl: str(p?.ProductDetailUrl) || undefined,
    });
  }
  const total = typeof json?.SearchResults?.NumberOfResult === 'number' ? json.SearchResults.NumberOfResult : undefined;
  return { provider: 'mouser', parts, total, note: 'Prices from Mouser Search API v1 in your account currency.' };
}

// ------------------------------------------------------------- manual links

/** LCSC product page for a stock code (C-number). */
export function lcscProductUrl(code: string): string {
  const c = str(code).toUpperCase();
  if (!/^C\d{3,}$/.test(c)) throw new CatalogError(`"${code}" is not an LCSC stock code (expected e.g. C7593).`);
  return `https://www.lcsc.com/product-detail/${c}.html`;
}

export function lcscSearchUrl(query: string): string {
  return `https://www.lcsc.com/search?q=${encodeURIComponent(normalizeQuery(query))}`;
}

export function digikeySearchUrl(query: string): string {
  return `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(normalizeQuery(query))}`;
}

export function mouserSearchUrl(query: string): string {
  return `https://www.mouser.com/c/?q=${encodeURIComponent(normalizeQuery(query))}`;
}

// ------------------------------------------------------------------ network

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  ms = CATALOG_TIMEOUT_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new CatalogError(`Distributor timed out after ${Math.round(ms / 1000)}s.`);
    throw new CatalogError(`Could not reach the distributor: ${e?.message ?? e}`);
  } finally {
    clearTimeout(t);
  }
}

async function failFrom(res: Response, label: string): Promise<never> {
  const body = await res.text().catch(() => '');
  let detail = body.slice(0, 240);
  try {
    const j = JSON.parse(body);
    detail = j?.ErrorMessage ?? j?.detail ?? j?.error_description ?? detail;
  } catch {
    /* not JSON — keep the raw text */
  }
  if (res.status === 429) throw new CatalogError(`${label} rate limit reached (HTTP 429). Wait a moment and retry.`, { status: 429 });
  if (res.status === 401 || res.status === 403)
    throw new CatalogError(`${label} rejected the credentials (HTTP ${res.status}). ${detail}`.trim(), { status: res.status });
  throw new CatalogError(`${label} error ${res.status}: ${detail || 'no details'}`, { status: res.status });
}

const digikeyTokens = new Map<string, { token: string; exp: number }>();

/** Test hook — forget cached OAuth tokens. */
export function clearDigiKeyTokenCache(): void {
  digikeyTokens.clear();
}

async function digikeyToken(creds: { clientId: string; clientSecret: string }, fetchImpl: typeof fetch, fresh: boolean): Promise<string> {
  const cached = digikeyTokens.get(creds.clientId);
  if (!fresh && cached && cached.exp > Date.now()) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  }).toString();
  const res = await timedFetch(fetchImpl, DIGIKEY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) await failFrom(res, 'DigiKey OAuth');
  const json: any = await res.json().catch(() => null);
  const token = str(json?.access_token);
  if (!token) throw new CatalogError('DigiKey OAuth returned no access token.', { status: 502 });
  const ttl = Number(json?.expires_in);
  const life = Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 600_000;
  digikeyTokens.set(creds.clientId, { token, exp: Date.now() + life - 60_000 });
  return token;
}

/** Perform the real HTTP calls. `fetchImpl` is injectable so checks can mock it. */
export async function runCatalogSearch(
  query: CatalogQuery,
  creds: CatalogCredentials = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogResult> {
  const q = normalizeQuery(query.query);
  const limit = normalizeLimit(query.limit);
  const offset = normalizeOffset(query.offset);

  if (query.provider === 'digikey') {
    const c = creds.digikey;
    if (!str(c?.clientId) || !str(c?.clientSecret))
      throw new CatalogError('DigiKey needs a client ID and client secret — create an app at developer.digikey.com.');
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-DIGIKEY-Client-Id': c!.clientId,
      'X-DIGIKEY-Locale-Site': 'US',
      'X-DIGIKEY-Locale-Language': 'en',
      'X-DIGIKEY-Locale-Currency': 'USD',
    };
    const body = JSON.stringify(digikeySearchBody(q, limit, offset));
    let token = await digikeyToken(c!, fetchImpl, false);
    let res = await timedFetch(fetchImpl, DIGIKEY_SEARCH_URL, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body,
    });
    if (res.status === 401) {
      digikeyTokens.delete(c!.clientId);
      token = await digikeyToken(c!, fetchImpl, true);
      res = await timedFetch(fetchImpl, DIGIKEY_SEARCH_URL, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body,
      });
    }
    if (!res.ok) await failFrom(res, 'DigiKey');
    const json: any = await res.json().catch(() => null);
    if (!json) throw new CatalogError('DigiKey returned a non-JSON response.', { status: 502 });
    return parseDigiKeyProducts(json);
  }

  if (query.provider === 'mouser') {
    const key = str(creds.mouser?.apiKey);
    if (!key) throw new CatalogError('Mouser needs an API key — request one at mouser.com/api-search.');
    const res = await timedFetch(fetchImpl, mouserSearchEndpoint(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(mouserSearchBody(q, limit, offset)),
    });
    if (!res.ok) await failFrom(res, 'Mouser');
    const json: any = await res.json().catch(() => null);
    if (!json) throw new CatalogError('Mouser returned a non-JSON response.', { status: 502 });
    return parseMouserParts(json);
  }

  if (query.provider === 'lcsc')
    throw new CatalogError(
      'LCSC publishes no public product API, so FOSS-PCB will not fake results. Use the LCSC search or C-number links instead.',
    );

  throw new CatalogError(`Unknown catalog provider "${String((query as any).provider)}".`);
}

// ------------------------------------------------------------------- caching

const searchCache = new Map<string, { at: number; result: CatalogResult }>();

/** Non-reversible credential fingerprint for the cache key. Keys stay in
 *  memory and are never written to disk; hashing keeps secrets out of the key. */
function credentialFingerprint(creds: CatalogCredentials): string {
  const material =
    creds.digikey ? `d:${creds.digikey.clientId}\u0000${creds.digikey.clientSecret}` : creds.mouser ? `m:${creds.mouser.apiKey}` : 'none';
  let h = 5381;
  for (let i = 0; i < material.length; i++) h = ((h << 5) + h + material.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Test hook — drop all cached search results. */
export function clearCatalogCache(): void {
  searchCache.clear();
}

/** Cached wrapper around runCatalogSearch. Only successful results are stored,
 *  per provider + query + page + credential fingerprint, and only for a short
 *  TTL. A credential change therefore never reuses another account's prices. */
export async function cachedCatalogSearch(
  query: CatalogQuery,
  creds: CatalogCredentials = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogResult> {
  const q = normalizeQuery(query.query);
  const limit = normalizeLimit(query.limit);
  const offset = normalizeOffset(query.offset);
  const key = `${query.provider}|${q.toLowerCase()}|${limit}|${offset}|${credentialFingerprint(creds)}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_CACHE_TTL_MS) return hit.result;

  const result = await runCatalogSearch({ ...query, query: q, limit, offset }, creds, fetchImpl);
  searchCache.delete(key);
  searchCache.set(key, { at: Date.now(), result });
  while (searchCache.size > CATALOG_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
  return result;
}

/** Transport-agnostic entry point used by the UI. */
export async function searchCatalog(query: CatalogQuery, creds: CatalogCredentials): Promise<CatalogResult> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return cachedCatalogSearch(query, creds, tauriFetch as unknown as typeof fetch);
  }
  let res: Response;
  try {
    res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...query, credentials: creds }),
    });
  } catch (e: any) {
    throw new CatalogError(`Live search needs the desktop app or a running dev server (${e?.message ?? e}).`);
  }
  if (!res.ok) {
    const j: any = await res.json().catch(() => null);
    if (res.status === 404)
      throw new CatalogError('Live search needs the desktop app or a running dev server (`npm run dev`).', { status: 404 });
    throw new CatalogError(str(j?.error) || `Catalog request failed (HTTP ${res.status}).`, { status: res.status });
  }
  const j: any = await res.json().catch(() => null);
  if (!j) throw new CatalogError('Catalog proxy returned a non-JSON response.', { status: 502 });
  return j as CatalogResult;
}

/** Curated-library match for a distributor MPN: only an exact, case-insensitive
 *  hit is trusted, because the library carries verified footprints. */
export function matchLibraryMpn(mpn: string, library: { mpn: string }[]): string | null {
  const m = str(mpn).toLowerCase();
  if (!m) return null;
  return library.find((p) => str(p.mpn).toLowerCase() === m)?.mpn ?? null;
}
