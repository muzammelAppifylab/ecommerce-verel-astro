/* Machine-translation providers (WP-25; VAREL worker/lib/i18n/providers/*): keys from owner secrets, fixed hosts,
   response shapes, retries without sleeping, mock never on the live site. */
import assert from 'node:assert/strict';
import {afterEach, describe, it, vi} from 'vitest';

import {config} from '../src/platform/config';
import {deeplHost, deeplProvider, deeplTarget, esc, unesc} from '../src/server/lib/i18n/providers/deepl';
import {getProvider, providerNameOf, providerReady} from '../src/server/lib/i18n/providers';
import {TranslateError, withRetry} from '../src/server/lib/i18n/providers/types';
import {textOf, workersAiProvider, workersAiUrl} from '../src/server/lib/i18n/providers/workers-ai';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

function secrets(values: Record<string, string>) {
  vi.spyOn(config, 'ownerSecret').mockImplementation((name: string) => values[name] ?? null);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DeepL', () => {
  it('escapes text but keeps the markers, and unescapes the answer', () => {
    assert.equal(esc('A & B <x0/> <b>'), 'A &amp; B <x0/> &lt;b&gt;');
    assert.equal(unesc('A &amp; B &lt;b&gt; &quot;q&quot; &#39;s'), 'A & B <b> "q" \'s');
  });
  it('maps target codes and picks the host from the key', () => {
    assert.equal(deeplTarget('en'), 'EN-GB');
    assert.equal(deeplTarget('pt'), 'PT-PT');
    assert.equal(deeplTarget('da'), 'DA');
    assert.equal(deeplHost('abc:fx'), 'https://api-free.deepl.com');
    assert.equal(deeplHost('abc'), 'https://api.deepl.com');
  });
  it('is ready only with its key, and calls the fixed host', async () => {
    secrets({});
    assert.equal(providerReady('deepl'), false);
    assert.equal(deeplProvider(), null);
    vi.restoreAllMocks();
    secrets({DEEPL_API_KEY: 'k:fx'});
    assert.equal(providerReady('deepl'), true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({translations: [{text: 'Hej &amp; farvel'}]}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    assert.deepEqual(await deeplProvider()!.translate(['Hi & bye'], 'en', 'da'), ['Hej & farvel']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    assert.equal(url, 'https://api-free.deepl.com/v2/translate');
    assert.equal((init.headers as Record<string, string>).Authorization, 'DeepL-Auth-Key k:fx');
    assert.ok(init.signal);
  });
  it('refuses an answer with the wrong number of translations', async () => {
    secrets({DEEPL_API_KEY: 'k'});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({translations: []}), {status: 200})));
    await assert.rejects(deeplProvider()!.translate(['a', 'b'], 'en', 'da'), TranslateError);
  });
});

describe('Workers AI (REST)', () => {
  it('needs both secrets and a 32-hex account id', () => {
    secrets({CF_ACCOUNT_ID: ACCOUNT});
    assert.equal(providerReady('workers-ai'), false);
    vi.restoreAllMocks();
    secrets({CF_ACCOUNT_ID: 'not-an-account', CF_AI_TOKEN: 't'});
    assert.equal(providerReady('workers-ai'), false);
    vi.restoreAllMocks();
    secrets({CF_ACCOUNT_ID: ACCOUNT, CF_AI_TOKEN: 't'});
    assert.equal(providerReady('workers-ai'), true);
  });
  it('builds the URL from the account id', () => {
    assert.equal(workersAiUrl(ACCOUNT), `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/m2m100-1.2b`);
  });
  it('reads both answer shapes and refuses a missing text', () => {
    assert.equal(textOf({translated_text: 'Hej'}), 'Hej');
    assert.equal(textOf({result: {translated_text: 'Hej'}}), 'Hej');
    assert.throws(() => textOf({result: {}}), TranslateError);
    assert.throws(() => textOf(null), TranslateError);
  });
  it('translates one string per request, in order', async () => {
    secrets({CF_ACCOUNT_ID: ACCOUNT, CF_AI_TOKEN: 't'});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const {text} = JSON.parse(String(init.body)) as {text: string};
        return new Response(JSON.stringify({result: {translated_text: `da:${text}`}}), {status: 200});
      })
    );
    assert.deepEqual(await workersAiProvider()!.translate(['a', 'b', 'c'], 'en', 'da'), ['da:a', 'da:b', 'da:c']);
  });
});

describe('provider selection', () => {
  it('maps unknown names to workers-ai and "none" to no provider', () => {
    assert.equal(providerNameOf('deepl'), 'deepl');
    assert.equal(providerNameOf('nope'), 'workers-ai');
    assert.equal(providerNameOf(null), 'workers-ai');
    assert.equal(getProvider('none'), null);
    assert.equal(providerReady('none'), false);
  });
  it('never offers the mock on the live site', () => {
    vi.spyOn(config, 'production', 'get').mockReturnValue(false);
    assert.equal(providerReady('mock'), true);
    assert.ok(getProvider('mock'));
    vi.restoreAllMocks();
    vi.spyOn(config, 'production', 'get').mockReturnValue(true);
    assert.equal(providerReady('mock'), false);
    assert.equal(getProvider('mock'), null);
  });
});

describe('withRetry', () => {
  it('retries once at once on a server error or a network error', async () => {
    let n = 0;
    const started = Date.now();
    const out = await withRetry(async () => {
      if (++n === 1) throw new TranslateError('boom', 503);
      return 'ok';
    });
    assert.equal(out, 'ok');
    assert.equal(n, 2);
    assert.ok(Date.now() - started < 200, 'never sleeps');
    n = 0;
    await assert.rejects(
      withRetry(async () => {
        n++;
        throw new TranslateError('unreachable');
      })
    );
    assert.equal(n, 2);
  });
  it('does not retry a 429 or another client error', async () => {
    for (const status of [429, 400, 403]) {
      let n = 0;
      await assert.rejects(
        withRetry(async () => {
          n++;
          throw new TranslateError('no', status);
        })
      );
      assert.equal(n, 1);
    }
  });
});
