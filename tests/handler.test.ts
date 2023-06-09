import tap from 'tap';
import {
  ProxyConfig,
  ParseOptions,
  createHandler,
  parseOriginResponse,
  proxy,
  ParsedRequest,
  createGraphQLProxy,
  isParsedError,
} from '../src';
import { Headers, Response, Request } from '@whatwg-node/fetch';

const defaultConfig: ProxyConfig = {
  originURL: 'http://app.localhost',
};

const parseOptions: ParseOptions = {
  errorMasking: '[Suggestion hidden]',
  removeExtensions: true,
};

tap.test('happy path', async (t) => {
  const proxyResponse = new Response(JSON.stringify({ data: { works: true } }), {
    status: 200,
    headers: new Headers({
      'content-type': 'application/json',
    }),
  });

  const handler = createHandler<ParsedRequest>(
    defaultConfig.originURL,
    async (req) => {
      t.equal(await req.text(), 'input');
      return {
        query: 'q',
        headers: new Headers(),
        variables: {},
      };
    },
    {
      proxy: async (req) => {
        t.equal((req as any).query, 'q');
        return proxyResponse;
      },
      formatOriginResp: async (gql) => {
        t.same(gql.data, { works: true });
        return new Response('response', {
          status: 200,
        });
      },
    }
  );

  const resp = await handler(
    new Request('http://test.localhost', {
      method: 'POST',
      body: Buffer.from('input'),
    })
  );
  t.equal(await resp.text(), 'response');
});

tap.test('happy path with defaults', async (t) => {
  const {
    parseRequest: parse,
    proxy,
    parseResponse: parseProxy,
  } = createGraphQLProxy(
    'http://test.localhost',
    async (req) => {
      return {
        query: 'q1',
        headers: req.headers,
      };
    },
    {
      proxy: async () => new Response('ok'),
    }
  );

  const parsed = await parse(
    new Request('http://test.localhost', {
      method: 'POST',
      headers: new Headers({ 'x-host': 'localhost' }),
      body: Buffer.from('input'),
    })
  );

  if (isParsedError(parsed)) {
    t.fail('cannot parse');
    return;
  }

  const proxyResp = await proxy(parsed);
  const resp = await parseProxy(proxyResp);

  t.equal(resp, null);
});

tap.test('origin not reachable', async (t) => {
  const handler = createHandler('http://test.blabaladwadwaadwad', async (req) => {
    return {
      query: 'q1',
      headers: req.headers,
    };
  });

  const resp = await handler(
    new Request('http://test.blabaladwadwaadwad', {
      method: 'POST',
      headers: new Headers({ 'x-host': 'localhost' }),
      body: Buffer.from('input'),
    })
  );
  t.equal(resp.status, 500);
  t.same(await resp.json(), { message: 'getaddrinfo ENOTFOUND test.blabaladwadwaadwad' });
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
