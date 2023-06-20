import { ProxyConfig, errorCodeSymbol, errorMessageSymbol, proxy } from '../src';
import { createSignatureParseFn, OPERATION_HEADER_KEY, PASSTHROUGH_HEADER_KEY } from '../src/signature';
import tap from 'tap';
import { Headers, Response, Request } from '@whatwg-node/fetch';
import { printExecutableGraphQLDocument } from '@graphql-tools/documents';
import { createHmac } from 'node:crypto';
import { DocumentNode, parse } from 'graphql';
import crypto from 'node:crypto';

const defaultPassThroughSecret = 'pass';

const signOptions = {
  maxTokens: 1000,
  passThroughHash: crypto.createHash('sha256').update(defaultPassThroughSecret).digest('hex'),
  signSecret: 'signature',
};

const parseFn = createSignatureParseFn(signOptions);

const defaultConfig: ProxyConfig = {
  originURL: 'http://app.localhost',
  originFetch: async () => new Response('ok'),
};

function calculateHashFromQuery(document: DocumentNode, secret: string, algo = 'sha256') {
  const printedDoc = printExecutableGraphQLDocument(document);
  // hash with hmac
  return createHmac(algo, secret).update(printedDoc).digest('hex');
}

tap.test('no hash header set', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    body: JSON.stringify({
      query: '123',
    }),
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], 'signature not defined');
});

tap.test('no query defined on body', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: 'hash123',
    }),
    body: JSON.stringify({
      quer: '123',
    }),
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], 'Missing query in body');
});

tap.test('not valid document provided', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: 'hash123',
    }),
    body: JSON.stringify({
      query: 'invaliddoc',
    }),
  });

  const parsed: any = await parseFn(req);

  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], 'cannot parse query');
});

tap.test('not valid hash provided', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: 'hash123',
    }),
    body: JSON.stringify({
      query: 'query me { me }',
    }),
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], `Invalid ${OPERATION_HEADER_KEY} header`);
});

tap.test('signed with diff secret', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), 'kaboom');
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: hash,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], `Invalid ${OPERATION_HEADER_KEY} header`);
});

tap.test('signed with custom algorithms', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), signOptions.signSecret, 'sha512');
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: hash,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const parseFn = createSignatureParseFn({
    maxTokens: 1000,
    passThroughHash: '123',
    signSecret: {
      algorithm: 'SHA-1',
      secret: signOptions.signSecret,
    },
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], `Invalid ${OPERATION_HEADER_KEY} header`);
});

tap.test('not valid json body', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), signOptions.signSecret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: hash,
    }),
    body: 'wawdaw',
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed[errorCodeSymbol], 403);
  t.same(parsed[errorMessageSymbol], 'not valid body');
});

tap.test('signed with custom algorithms', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), signOptions.signSecret, 'sha512');
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      [OPERATION_HEADER_KEY]: hash,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const parseFn = createSignatureParseFn({
    passThroughHash: '123',
    maxTokens: 1000,
    signSecret: {
      algorithm: 'SHA-512',
      secret: signOptions.signSecret,
    },
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed.query, 'query me {me}');
  t.equal(parsed.isPassthrough, false);
});

tap.test('skips signature when sign_secret is null', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({}),
    body: JSON.stringify({
      query: 'query me { me }',
    }),
  });

  const parseFn = createSignatureParseFn({
    maxTokens: 1000,
    signSecret: null,
    passThroughHash: '123',
  });

  const parsed: any = await parseFn(req);
  t.equal(parsed.query, 'query me { me }');
  t.equal(parsed.isPassthrough, false);
});

tap.test('pass through', async (t) => {
  t.test('no signature required', async (t) => {
    const req = new Request('http://test.localhost', {
      method: 'POST',
      headers: new Headers({
        [OPERATION_HEADER_KEY]: 'hash123',
        [PASSTHROUGH_HEADER_KEY]: defaultPassThroughSecret,
      }),
      body: JSON.stringify({
        query: 'query me { me }',
      }),
    });

    const resp = await proxy(await parseFn(req), {
      ...defaultConfig,
      async originFetch() {
        return new Response(Buffer.from('works'), {
          status: 200,
          headers: new Headers({
            'content-type': 'application/text',
          }),
        });
      },
    });
    t.equal(await resp.text(), 'works');
    t.equal(resp.status, 200);
  });

  t.test('wrong passthrough', async (t) => {
    const req = new Request('http://test.localhost', {
      method: 'POST',
      headers: new Headers({
        [OPERATION_HEADER_KEY]: 'hash123',
        [PASSTHROUGH_HEADER_KEY]: 'KABOOM',
      }),
      body: JSON.stringify({
        query: 'query me { me }',
      }),
    });

    const resp = await proxy(await parseFn(req), {
      ...defaultConfig,
      async originFetch() {
        return new Response(Buffer.from('works'), {
          status: 200,
          headers: new Headers({
            'content-type': 'application/text',
          }),
        });
      },
    });
    t.same(await resp.json(), { message: `Invalid ${OPERATION_HEADER_KEY} header` });
    t.equal(resp.status, 403);
  });
});
