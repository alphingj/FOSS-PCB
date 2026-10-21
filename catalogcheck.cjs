// Live distributor catalog checks — request shapes, response normalisation,
// credential handling, error surfacing and the LCSC no-fake-results policy.
// No network: the HTTP layer is driven by an injected mock fetch.
const {
  runCatalogSearch,
  parseDigiKeyProducts,
  parseMouserParts,
  digikeySearchBody,
  mouserSearchBody,
  mouserSearchEndpoint,
  parsePrice,
  parseStockText,
  normalizeQuery,
  normalizeLimit,
  lcscProductUrl,
  lcscSearchUrl,
  matchLibraryMpn,
  clearDigiKeyTokenCache,
  cachedCatalogSearch,
  clearCatalogCache,
  CATALOG_CACHE_TTL_MS,
  CATALOG_MAX_LIMIT,
} = require('CATDIR/catalog.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };
const res = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ------------------------------------------------------------ request shapes
const dkBody = digikeySearchBody('NE555DR', 25, 0);
assert(dkBody.Keywords === 'NE555DR', 'DigiKey body uses Keywords');
assert(dkBody.Limit === 25 && dkBody.Offset === 0, 'DigiKey body uses Limit/Offset (current v4 docs)');
assert(Array.isArray(dkBody.FilterOptionsRequest.SearchOptions), 'DigiKey body carries FilterOptionsRequest.SearchOptions');
assert(!('RecordCount' in dkBody) && !('RecordStartPosition' in dkBody), 'DigiKey body avoids the legacy field names');

const mBody = mouserSearchBody('NE555DR', 25, 0);
assert(mBody.SearchByKeywordRequest, 'Mouser body uses the SearchByKeywordRequest wrapper', Object.keys(mBody));
assert(mBody.SearchByKeywordRequest.keyword === 'NE555DR', 'Mouser keyword field is lowercase');
assert(mBody.SearchByKeywordRequest.records === 25, 'Mouser records field');
assert(mBody.SearchByKeywordRequest.searchOptions === 'InStock', 'Mouser searchOptions set');
assert(mouserSearchEndpoint('k ey').endsWith('apiKey=k%20ey'), 'Mouser endpoint URL-encodes the key');

// ------------------------------------------------------------------ parsing
const dkJson = {
  ProductsCount: 42,
  Products: [
    {
      ManufacturerProductNumber: 'NE555DR',
      Manufacturer: { Id: 564, Name: 'Texas Instruments' },
      Description: { ProductDescription: 'IC OSC SGL TIMER 100KHZ 8-SOIC', DetailedDescription: 'longer text' },
      UnitPrice: 0.174,
      QuantityAvailable: 61234,
      ProductUrl: 'https://www.digikey.com/en/products/detail/texas-instruments/NE555DR/276559',
      DatasheetUrl: 'https://www.ti.com/lit/ds/symlink/ne555.pdf',
      ProductVariations: [
        {
          DigiKeyProductNumber: '296-6501-5-ND',
          PackageType: { Id: 1, Name: 'Tube' },
          QuantityAvailableforPackageType: 61234,
          StandardPricing: [
            { BreakQuantity: 100, UnitPrice: 0.13, TotalPrice: 13 },
            { BreakQuantity: 1, UnitPrice: 0.174, TotalPrice: 0.174 },
          ],
        },
      ],
    },
    { Description: { ProductDescription: 'no MPN — must be dropped' } },
  ],
};
const dk = parseDigiKeyProducts(dkJson, 'USD');
assert(dk.parts.length === 1, 'DigiKey drops rows without an MPN', dk.parts.length);
const dkp = dk.parts[0];
assert(dkp.mpn === 'NE555DR' && dkp.manufacturer === 'Texas Instruments', 'DigiKey MPN/manufacturer mapped');
assert(dkp.distributorPart === '296-6501-5-ND' && dkp.package === 'Tube', 'DigiKey ordering code + package mapped');
assert(dkp.stock === 61234 && dkp.stockText.includes('61,234'), 'DigiKey stock mapped', dkp.stockText);
assert(dkp.unitPrice === 0.174 && dkp.currency === 'USD', 'DigiKey unit price + currency');
assert(dkp.priceBreaks.length === 2 && dkp.priceBreaks[0].qty === 1, 'DigiKey price breaks sorted by qty', JSON.stringify(dkp.priceBreaks));
assert(dkp.datasheetUrl.includes('ne555.pdf') && dkp.productUrl.includes('digikey.com'), 'DigiKey links mapped');
assert(dk.total === 42, 'DigiKey total count mapped');
assert(parseDigiKeyProducts({}, 'USD').parts.length === 0, 'DigiKey tolerates an empty body');
assert(parseDigiKeyProducts({ Products: 'nope' }, 'USD').parts.length === 0, 'DigiKey tolerates a malformed Products field');

const moJson = {
  Errors: [],
  SearchResults: {
    NumberOfResult: 3,
    Parts: [
      {
        ManufacturerPartNumber: 'NE555DR',
        Manufacturer: 'Texas Instruments',
        Description: 'Standard Timer Single 8-Pin SOIC',
        MouserPartNumber: '595-NE555DR',
        Availability: '12,345 In Stock',
        AvailabilityInStock: '12,345',
        DataSheetUrl: 'https://www.ti.com/lit/ds/symlink/ne555.pdf',
        ProductDetailUrl: 'https://www.mouser.com/ProductDetail/595-NE555DR',
        PriceBreaks: [
          { Quantity: 1, Price: '$0.18', Currency: 'USD' },
          { Quantity: 10, Price: '$0.13', Currency: 'USD' },
        ],
        ProductAttributes: [{ AttributeName: 'Package / Case', AttributeValue: 'SOIC-8' }],
      },
      { MouserPartNumber: '595-ONLYPN', Description: 'Mouser PN only — kept as identifier' },
      { Description: 'no identifiers at all — dropped' },
    ],
  },
};
const mo = parseMouserParts(moJson);
assert(mo.parts.length === 2, 'Mouser drops rows without any identifier', mo.parts.length);
assert(mo.parts[1].mpn === '595-ONLYPN' && mo.parts[1].distributorPart === '595-ONLYPN', 'Mouser falls back to its own PN as the identifier');
const mop = mo.parts[0];
assert(mop.mpn === 'NE555DR' && mop.distributorPart === '595-NE555DR', 'Mouser MPN/distributor PN mapped');
assert(mop.stock === 12345 && mop.stockText === '12,345 In Stock', 'Mouser stock from AvailabilityInStock', mop.stockText);
assert(mop.unitPrice === 0.18 && mop.currency === 'USD', 'Mouser price + currency parsed from strings', JSON.stringify([mop.unitPrice, mop.currency]));
assert(mop.priceBreaks.length === 2 && mop.priceBreaks[1].qty === 10, 'Mouser price breaks sorted');
assert(mop.package === 'SOIC-8', 'Mouser package from attributes');
assert(mo.total === 3, 'Mouser total mapped');

let moErr = '';
try { parseMouserParts({ Errors: [{ Message: 'Invalid API key', PropertyName: 'ApiKey' }], SearchResults: null }); } catch (e) { moErr = e.message; }
assert(/Invalid API key/.test(moErr) && /ApiKey/.test(moErr), 'Mouser Errors are surfaced verbatim', moErr);

// Ambiguous money/stock formats are refused, never guessed.
assert(parsePrice('$0.42') === 0.42, 'parsePrice strips a currency symbol');
assert(parsePrice('1,234.56') === 1234.56, 'parsePrice handles thousands separators with a dot decimal');
assert(parsePrice('0,42 €') === undefined, 'parsePrice refuses comma-decimal (ambiguous)');
assert(parsePrice('abc') === undefined && parsePrice(undefined) === undefined, 'parsePrice refuses junk');
assert(parseStockText('1,234').count === 1234, 'parseStockText plain count');
assert(parseStockText('Non-Stock').count === undefined, 'parseStockText refuses free text');
assert(parseStockText('').count === undefined, 'parseStockText handles empty');

assert(normalizeLimit(undefined) === 25 && normalizeLimit(999) === CATALOG_MAX_LIMIT, 'limit default + clamp');
assert(normalizeQuery('  NE555  ') === 'NE555', 'query trimmed');
let qErr = '';
try { normalizeQuery('   '); } catch (e) { qErr = e.message; }
assert(/Enter a part number/.test(qErr), 'empty query rejected', qErr);

// ------------------------------------------------------------------ links
assert(lcscProductUrl('c7593').endsWith('/C7593.html'), 'LCSC product URL built from a code');
assert(lcscSearchUrl('NE 555').includes('q=NE%20555'), 'LCSC search URL encodes the query');
let lcscErr = '';
try { lcscProductUrl('NE555'); } catch (e) { lcscErr = e.message; }
assert(/not an LCSC stock code/.test(lcscErr), 'invalid LCSC code rejected', lcscErr);
assert(matchLibraryMpn('ne555dr', [{ mpn: 'NE555DR' }]) === 'NE555DR', 'library match is case-insensitive');
assert(matchLibraryMpn('NE555DRX', [{ mpn: 'NE555DR' }]) === null, 'library match requires an exact MPN');

// --------------------------------------------------------------- transports
async function mouserSearch(fetchImpl) {
  return runCatalogSearch({ provider: 'mouser', query: 'NE555DR', limit: 5 }, { mouser: { apiKey: 'SECRETKEY' } }, fetchImpl);
}

(async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, init });
    return res(moJson);
  };
  const moResult = await mouserSearch(okFetch);
  assert(calls.length === 1 && calls[0].url.includes('apiKey=SECRETKEY'), 'Mouser search hits the documented endpoint once');
  assert(calls[0].init.method === 'POST' && calls[0].init.headers['Content-Type'] === 'application/json', 'Mouser search is a JSON POST');
  assert(moResult.parts[0].mpn === 'NE555DR', 'Mouser search returns normalised parts');

  let tooManyErr = '';
  try { await mouserSearch(async () => res({ Errors: null }, 429)); } catch (e) { tooManyErr = e.message; }
  assert(/rate limit/i.test(tooManyErr), '429 becomes a rate-limit message', tooManyErr);

  let timeoutErr = '';
  try {
    await mouserSearch(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  } catch (e) { timeoutErr = e.message; }
  assert(/timed out/i.test(timeoutErr), 'aborted request becomes a timeout message', timeoutErr);

  let noKeyErr = '';
  try { await runCatalogSearch({ provider: 'mouser', query: 'x' }, {}); } catch (e) { noKeyErr = e.message; }
  assert(/needs an API key/.test(noKeyErr), 'missing Mouser key is explained', noKeyErr);

  // --- DigiKey: OAuth token, then the search, then a cached token ---
  clearDigiKeyTokenCache();
  const dkCalls = [];
  const dkFetch = async (url, init) => {
    dkCalls.push({ url, init });
    if (url.includes('/oauth2/token')) return res({ access_token: 'TOK1', expires_in: 600, token_type: 'Bearer' });
    return res(dkJson);
  };
  const dkCreds = { digikey: { clientId: 'CLIENTID', clientSecret: 'CLIENTSECRET' } };
  const dkResult = await runCatalogSearch({ provider: 'digikey', query: 'NE555DR', limit: 5 }, dkCreds, dkFetch);
  assert(dkCalls.length === 2, 'DigiKey does token + search', dkCalls.length);
  assert(dkCalls[0].url.includes('/v1/oauth2/token') && dkCalls[0].init.body.includes('grant_type=client_credentials'), 'DigiKey OAuth uses client credentials');
  assert(dkCalls[0].init.body.includes('client_secret=CLIENTSECRET'), 'DigiKey OAuth sends the secret to the token endpoint only');
  const searchCall = dkCalls[1];
  assert(searchCall.url.includes('/products/v4/search/keyword'), 'DigiKey search endpoint');
  assert(searchCall.init.headers['X-DIGIKEY-Client-Id'] === 'CLIENTID', 'DigiKey search sends X-DIGIKEY-Client-Id');
  assert(searchCall.init.headers.Authorization === 'Bearer TOK1', 'DigiKey search sends the bearer token');
  assert(searchCall.init.headers['X-DIGIKEY-Locale-Currency'] === 'USD', 'DigiKey search sends the locale headers');
  assert(!JSON.stringify(JSON.parse(searchCall.init.body)).includes('CLIENTSECRET'), 'DigiKey search body never carries the client secret');
  assert(dkResult.parts[0].mpn === 'NE555DR', 'DigiKey search returns normalised parts');

  const before = dkCalls.length;
  await runCatalogSearch({ provider: 'digikey', query: 'NE555DR' }, dkCreds, dkFetch);
  assert(dkCalls.length === before + 1, 'DigiKey reuses the cached OAuth token', dkCalls.length - before);

  // Expired/invalid token: 401 triggers one refresh and one retry.
  clearDigiKeyTokenCache();
  let dk401 = 0;
  let tok = 0;
  const dkRetryFetch = async (url, init) => {
    if (url.includes('/oauth2/token')) return res({ access_token: `TOK${++tok}`, expires_in: 600 });
    dk401++;
    if (dk401 === 1) return res({ detail: 'token expired' }, 401);
    return res(dkJson);
  };
  const retried = await runCatalogSearch({ provider: 'digikey', query: 'NE555DR' }, dkCreds, dkRetryFetch);
  assert(dk401 === 2 && tok === 2, 'DigiKey refreshes the token once on 401 and retries', JSON.stringify({ dk401, tok }));
  assert(retried.parts.length === 1, 'DigiKey retry returns parts');

  let dkNoCreds = '';
  try { await runCatalogSearch({ provider: 'digikey', query: 'x' }, { digikey: { clientId: 'a', clientSecret: '' } }); } catch (e) { dkNoCreds = e.message; }
  assert(/client ID and client secret/.test(dkNoCreds), 'incomplete DigiKey credentials are explained', dkNoCreds);

  let dkAuthErr = '';
  try {
    clearDigiKeyTokenCache();
    await runCatalogSearch({ provider: 'digikey', query: 'x' }, dkCreds, async () => res({ ErrorMessage: 'Invalid clientId' }, 401));
  } catch (e) { dkAuthErr = e.message; }
  assert(/rejected the credentials/.test(dkAuthErr) && /Invalid clientId/.test(dkAuthErr), 'DigiKey auth failure surfaces the vendor text', dkAuthErr);

  // --- LCSC: no public API, so no fabricated results ---
  let lcscLiveErr = '';
  try { await runCatalogSearch({ provider: 'lcsc', query: 'NE555' }, {}, async () => { throw new Error('network must not be touched'); }); } catch (e) { lcscLiveErr = e.message; }
  assert(/no public product API/.test(lcscLiveErr), 'LCSC live search refuses to fabricate results', lcscLiveErr);

  let unknownErr = '';
  try { await runCatalogSearch({ provider: 'octopart', query: 'x' }, {}); } catch (e) { unknownErr = e.message; }
  assert(/Unknown catalog provider/.test(unknownErr), 'unknown provider rejected', unknownErr);

  // --- cache: only successful searches, scoped by credentials and page ---
  clearCatalogCache();
  let cacheCalls = 0;
  const cacheFetch = async () => { cacheCalls++; return res(moJson); };
  const cq = { provider: 'mouser', query: 'NE555DR', limit: 25, offset: 0 };
  const c1 = await cachedCatalogSearch(cq, { mouser: { apiKey: 'KEY-A' } }, cacheFetch);
  const c2 = await cachedCatalogSearch(cq, { mouser: { apiKey: 'KEY-A' } }, cacheFetch);
  assert(cacheCalls === 1, 'identical search is served from cache', cacheCalls);
  assert(c1 === c2, 'cached result is reused');
  await cachedCatalogSearch({ ...cq, offset: 25 }, { mouser: { apiKey: 'KEY-A' } }, cacheFetch);
  assert(cacheCalls === 2, 'a different page is not a cache hit', cacheCalls);
  await cachedCatalogSearch(cq, { mouser: { apiKey: 'KEY-B' } }, cacheFetch);
  assert(cacheCalls === 3, 'different credentials never share cached prices', cacheCalls);
  clearCatalogCache();
  await cachedCatalogSearch(cq, { mouser: { apiKey: 'KEY-A' } }, cacheFetch);
  assert(cacheCalls === 4, 'clearCatalogCache forces a fresh request', cacheCalls);

  clearCatalogCache();
  let failCalls = 0;
  const failFetch = async () => { failCalls++; return res({ Errors: [{ Message: 'rejected' }] }, 400); };
  for (let i = 0; i < 2; i++) {
    try { await cachedCatalogSearch(cq, { mouser: { apiKey: 'KEY-A' } }, failFetch); } catch { /* expected */ }
  }
  assert(failCalls === 2, 'errors are never cached', failCalls);
  assert(CATALOG_CACHE_TTL_MS === 5 * 60_000, 'cache TTL is five minutes', CATALOG_CACHE_TTL_MS);

  console.log('ALL CATALOG CHECKS PASSED');
})().catch((e) => { console.error('FAIL: unhandled', e); process.exit(1); });
