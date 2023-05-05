import tap from 'tap';
import { handler } from '../src/handler';
import type { IncomingHttpHeaders } from 'http';
import { Headers, Response, Request } from '@whatwg-node/fetch';
import { printExecutableGraphQLDocument } from '@graphql-tools/documents';
import { createHmac } from 'node:crypto';
import { DocumentNode, parse } from 'graphql';
import EventEmitter, { once } from 'events';

export function toNodeHeaders(headers: Headers): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of headers) {
    // see https://github.com/vercel/next.js/blob/1088b3f682cbe411be2d1edc502f8a090e36dee4/packages/next/src/server/web/utils.ts#L29
    // if (key.toLowerCase() === 'set-cookie') {
    //   // We may have gotten a comma joined string of cookies, or multiple
    //   // set-cookie headers. We need to merge them into one header array
    //   // to represent all the cookies.
    //   cookies.push(...splitCookiesString(value))
    //   result[key] = cookies.length === 1 ? cookies[0] : cookies
    // } else {
    //   result[key] = value
    // }

    result[key] = value;
  }
  return result;
}

const defaultConfig = {
  maxTokens: 1000,
  url: new URL('http://app.localhost'),
  passThroughSecret: 'pass',
  secret: 'signature',
};

function calculateHashFromQuery(document: DocumentNode, secret: string) {
  const printedDoc = printExecutableGraphQLDocument(document);
  // hash with hmac
  return createHmac('sha256', secret).update(printedDoc).digest('hex');
}

tap.test('proxies non post/get methods directly', async (t) => {
  t.plan(2);
  const emptyResponse = new Response(null);
  const optionRequest = new Request('http://test.localhost', {
    method: 'OPTION',
  });

  const resp = await handler(optionRequest, {
    ...defaultConfig,
    async fetchFn(req) {
      t.equal(req, optionRequest);
      return emptyResponse;
    },
  });

  t.equal(resp, emptyResponse);
});

tap.test('no hash header set', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    body: JSON.stringify({
      query: '123',
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response('ok');
    },
  });
  const text = await resp.text();
  t.equal(resp.status, 403);
  t.equal(text, 'Invalid x-operation-hash header');
});

tap.test('no query defined on body', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': 'hash123',
    }),
    body: JSON.stringify({
      quer: '123',
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response('ok');
    },
  });
  const text = await resp.text();
  t.equal(resp.status, 403);
  t.equal(text, 'Missing query in body');
});

tap.test('not valid document provided', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': 'hash123',
    }),
    body: JSON.stringify({
      query: 'invaliddoc',
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response('ok');
    },
  });
  const text = await resp.text();
  t.equal(resp.status, 403);
  t.equal(text, 'cannot parse query');
});

tap.test('not valid hash provided', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': 'hash123',
    }),
    body: JSON.stringify({
      query: 'query me { me }',
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response('ok');
    },
  });
  const text = await resp.text();
  t.equal(resp.status, 403);
  t.equal(text, 'Invalid x-operation-hash header');
});

tap.test('dont valid signature when passthrough is provided', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': 'hash123',
      'x-proxy-passthrough': defaultConfig.passThroughSecret,
    }),
    body: JSON.stringify({
      query: 'query me { me }',
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
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

tap.test('error masking', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), defaultConfig.secret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': hash,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response(
        Buffer.from(
          JSON.stringify({
            data: null,
            errors: [
              {
                message: 'Did you mean "Type ABC"',
              },
              {
                message: 'Did you mean "Type ABC"',
              },
            ],
          })
        ),
        {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
        }
      );
    },
  });
  t.equal(resp.status, 200);

  const response = await resp.json();
  t.same(response.errors, [{ message: '[Suggestion hidden]' }, { message: '[Suggestion hidden]' }]);
});

tap.test('skip error masking when passthrough', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), defaultConfig.secret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': hash,
      'x-proxy-passthrough': defaultConfig.passThroughSecret,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const errors = [
    {
      message: 'Did you mean "Type ABC"',
    },
    {
      message: 'Did you mean "Type ABC"',
    },
  ];

  const resp = await handler(req, {
    ...defaultConfig,
    async fetchFn() {
      return new Response(
        Buffer.from(
          JSON.stringify({
            data: null,
            errors: errors,
          })
        ),
        {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
        }
      );
    },
  });
  t.equal(resp.status, 200);

  const response = await resp.json();
  t.same(response.errors, errors);
});

tap.test('creates operation report', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), defaultConfig.secret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': hash,
      // 'x-proxy-passthrough': defaultConfig.passThroughSecret,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const ee = new EventEmitter();

  const resp = await handler(req, {
    ...defaultConfig,
    waitUntilReport(promise) {
      promise.then((report) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        t.same(report!.args, []);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        t.equal(report!.exec.ok, true);
        ee.emit('waited');
      });
    },
    async fetchFn() {
      return new Response(
        Buffer.from(
          JSON.stringify({
            data: { me: 'me' },
            errors: [],
          })
        ),
        {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
        }
      );
    },
  });
  t.equal(resp.status, 200);
  await once(ee, 'waited');

  const response = await resp.json();
  t.same(response.errors, []);
  t.same(response.data, { me: 'me' });
});

tap.test('catches error when operation promise report throws', async (t) => {
  const query = 'query me {me}';
  const hash = calculateHashFromQuery(parse(query), defaultConfig.secret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': hash,
      // 'x-proxy-passthrough': defaultConfig.passThroughSecret,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const ee = new EventEmitter();

  const resp = await handler(req, {
    ...defaultConfig,
    waitUntilReport(promise) {
      promise
        .then(async () => {
          throw new Error('');
        })
        .catch(() => {
          ee.emit('final');
        });
    },
    async fetchFn() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(
        Buffer.from(
          JSON.stringify({
            data: { me: 'me' },
            errors: [],
          })
        ),
        {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
        }
      );
    },
  });

  const value = await resp.json();
  await once(ee, 'final');
  t.equal(resp.status, 200);
  t.same(value, {
    data: { me: 'me' },
    errors: [],
  });
});

tap.test('too many tokens', async (t) => {
  const query = 'query me {me b a c d}';
  const hash = calculateHashFromQuery(parse(query), defaultConfig.secret);
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      'x-operation-hash': hash,
      'x-proxy-passthrough': defaultConfig.passThroughSecret,
    }),
    body: JSON.stringify({
      query: query,
    }),
  });

  const resp = await handler(req, {
    ...defaultConfig,
    maxTokens: 5,
    async fetchFn() {
      return new Response(
        Buffer.from(
          JSON.stringify({
            data: {},
          })
        ),
        {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
          }),
        }
      );
    },
  });
  t.equal(resp.status, 403);
  t.equal(await resp.text(), 'cannot parse query');
});
