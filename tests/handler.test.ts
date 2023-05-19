import tap from 'tap';
import { ProxyConfig, ParseOptions, createHandler, parseOriginResponse, proxy, ParsedRequest } from '../src';
import { Headers, Response, Request } from '@whatwg-node/fetch';

const defaultConfig: ProxyConfig = {
  originURL: 'http://app.localhost',
};

const parseOptions: ParseOptions = {
  errorMasking: '[Suggestion hidden]',
  removeExtensions: true,
};

tap.test('happy path', async (t) => {
  t.plan(13);
  const proxyResponse = new Response(JSON.stringify({ data: { works: true } }), {
    status: 200,
    headers: new Headers({
      'content-type': 'application/json',
    }),
  });

  const handler = createHandler<{ prop: string }>(
    defaultConfig.originURL,
    async (req, ctx) => {
      t.equal(ctx.prop, 'ctx');
      t.equal(await req.text(), 'input');
      return {
        query: 'q',
        headers: new Headers(),
        variables: {},
      };
    },
    {
      proxy: async (req, ctx) => {
        t.equal(ctx.prop, 'ctxx');
        t.equal((req as any).query, 'q');
        return proxyResponse;
      },
      formatOriginResp: async (gql, _response, ctx) => {
        t.same(gql.data, { works: true });
        t.equal(ctx.prop, 'ctxx');
        return new Response('response', {
          status: 200,
        });
      },
      hooks: {
        onRequestParsed(parsed, ctx) {
          t.same((parsed as any).query, 'q');
          t.equal(ctx.prop, 'ctx');
          ctx.prop = 'ctxx';
        },
        onProxied(resp, ctx) {
          t.equal(resp, proxyResponse);
          t.equal(ctx.prop, 'ctxx');
        },
        onResponseParsed(originResponse, ctx) {
          t.same(originResponse.data, { works: true });
          t.equal(ctx.prop, 'ctxx');
        },
      },
    }
  );

  const resp = await handler(
    new Request('http://test.localhost', {
      method: 'POST',
      body: Buffer.from('input'),
    }),
    { prop: 'ctx' }
  );
  t.equal(await resp.text(), 'response');
});

tap.test('happy path with defaults', async (t) => {
  t.plan(3);

  const handler = createHandler(
    'http://test.localhost',
    async (req) => {
      return {
        query: 'q1',
        headers: req.headers,
      };
    },
    {
      proxy: async () => new Response('ok'),
      hooks: {
        onRequestParsed(parsed) {
          const p = parsed as ParsedRequest;
          t.equal(p.headers.get('x-host'), 'localhost');
          t.equal(p.query, 'q1');
        },
      },
    }
  );

  const resp = await handler(
    new Request('http://test.localhost', {
      method: 'POST',
      headers: new Headers({ 'x-host': 'localhost' }),
      body: Buffer.from('input'),
    }),
    { prop: 'ctx' }
  );
  t.same(await resp.json(), { message: 'cannot parse response' });
});

tap.test('correctly sets headers', async (t) => {
  const q = 'query me { me }';
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({
      Host: 'test.localhost',
      'x-forwarded-proto': 'http',
    }),
    body: JSON.stringify({
      query: q,
    }),
  });

  const resp = await proxy(
    { headers: req.headers, query: q },
    {
      ...defaultConfig,
      originFetch: async (url, request) => {
        t.equal(request.headers.get('X-Forwarded-Host'), 'test.localhost');
        t.equal(request.headers.get('content-type'), 'application/json');
        t.equal(request.headers.get('x-forwarded-proto'), 'http');
        return new Response('ok');
      },
    }
  );

  const text = await resp.text();

  t.equal(resp.status, 200);
  t.equal(text, 'ok');
});

tap.test('not valid response from origin', async (t) => {
  const q = 'query me { me }';
  const req = new Request('http://test.localhost', {
    method: 'POST',
    body: JSON.stringify({
      query: q,
    }),
  });

  const resp = await proxy(
    { headers: req.headers, query: q },
    {
      ...defaultConfig,
      originFetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return new Response('ok');
      },
    }
  );

  const text = await resp.text();

  t.equal(resp.status, 200);
  t.equal(text, 'ok');
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
});

// tap.test('cannot parse when different content-type', async (t) => {
//   const query = 'query me {me}';
//   const req = new Request('http://test.localhost', {
//     method: 'POST',
//     headers: new Headers({}),
//     body: JSON.stringify({
//       query: query,
//     }),
//   });

//   const originResponse = await proxy(
//     { headers: req.headers, query: query },
//     {
//       ...defaultConfig,
//       originFetch: async () =>
//         new Response(Buffer.from('ok'), {
//           status: 200,
//           headers: new Headers({
//             'content-type': 'application/text',
//           }),
//         }),
//     }
//   );
//   const resp = await parseOriginResponse(originResponse, parseOptions);

//   t.equal(resp.status, 406);
//   t.same(await resp.json(), { message: 'cannot parse response' });
// });

tap.test('error masking', async (t) => {
  const resp = await parseOriginResponse(
    {
      data: null,
      errors: [
        {
          message: 'Did you mean "Type ABC"',
        },
        {
          message: 'Did you mean "Type ABC"',
        },
      ],
    },
    new Response('ok'),
    parseOptions
  );

  t.equal(resp.status, 200);

  const response = await resp.json();
  t.same(response.errors, [{ message: '[Suggestion hidden]' }, { message: '[Suggestion hidden]' }]);
});

tap.test('no rules', async (t) => {
  const proxyResp = new Response(
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

  const resp = await parseOriginResponse(await proxyResp.json(), proxyResp, {});

  t.equal(resp.status, 200);

  const response = await resp.json();
  t.same(response.errors, []);
  t.same(response.data, { me: 'me' });
});
