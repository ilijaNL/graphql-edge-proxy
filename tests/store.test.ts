import tap from 'tap';
import { Config, proxy } from '../src';
import { GeneratedOperation, ValidationError, createOperationParseFn, createOperationStore } from '../src/operations';
import { Response, Request } from '@whatwg-node/fetch';

const parseFn = createOperationParseFn(createOperationStore([]));

const defaultConfig: Config = {
  originURL: 'http://app.localhost',

  originFetch: async () => new Response('ok'),
  // url: 'http://app.localhost',
  // passThroughHash: crypto.createHash('sha256').update(defaultPassThroughSecret).digest('hex'),
  responseRules: {
    errorMasking: '[Suggestion hidden]',
    removeExtensions: true,
  },
};

const query = 'query me { me }';

tap.test('rejects when not found', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const { response } = await proxy(await parseFn(req), defaultConfig);

  t.equal(response.status, 404);
  t.same(await response.json(), { message: 'no operation defined' });
});

tap.test('rejects when not found', async (t) => {
  const req = new Request('http://test.localhost', {
    method: 'POST',

    body: JSON.stringify({
      op: '123',
    }),
  });

  const { response } = await proxy(await parseFn(req), defaultConfig);

  t.equal(response.status, 404);
  t.same(await response.json(), { message: 'operation 123 not found' });
});

tap.test('happy path', async (t) => {
  const ops: Array<GeneratedOperation> = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    },
  ];

  const req = new Request('http://test.localhost', {
    method: 'POST',

    body: JSON.stringify({
      op: 'me',
    }),
  });
  const parseFn = createOperationParseFn(createOperationStore(ops));
  const { response } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (url, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(response.status, 200);
  t.equal(await response.text(), 'ok');
});

tap.test('happy path with get', async (t) => {
  const ops: Array<GeneratedOperation> = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    },
  ];

  const req = new Request('http://test.localhost?op=me', {
    method: 'GET',
  });
  const parseFn = createOperationParseFn(createOperationStore(ops));
  const { response } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (url, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(response.status, 200);
  t.equal(await response.text(), 'ok');

  const req2 = new Request('http://test.localhost?query=me', {
    method: 'GET',
  });

  const { response: resp2 } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (_, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(resp2.status, 200);
  t.equal(await resp2.text(), 'ok');
});

tap.test('not found when not post or get', async (t) => {
  const ops: Array<GeneratedOperation> = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    },
  ];

  const req = new Request('http://test.localhost?op=me', {
    method: 'PUT',
  });
  const parseFn = createOperationParseFn(createOperationStore(ops));
  const { response } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (_url, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(response.status, 404);
  t.same(await response.json(), { message: 'method not supported' });
});

tap.test('validate passes', async (t) => {
  t.plan(3);
  const ops: Array<GeneratedOperation> = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    },
  ];

  const store = createOperationStore(ops);

  store.setValidateFn<{ v1: string }>('me', (def, parsedRequest) => {
    t.same(def, {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    });

    if (parsedRequest.variables?.v1 === 'abc') {
      return;
    }

    return new ValidationError('not valid input');
  });

  const req = new Request('http://test.localhost?op=me&v=' + JSON.stringify({ v1: 'abc' }), {
    method: 'GET',
  });
  const parseFn = createOperationParseFn(createOperationStore(ops));
  const { response } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (_url, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(response.status, 200);
  t.same(await response.text(), 'ok');
});

tap.test('validate fails', async (t) => {
  t.plan(3);
  const ops: Array<GeneratedOperation> = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operationType: 'query',
      query: query,
    },
  ];

  const store = createOperationStore(ops);

  store.setValidateFn<{ v1: string }>('me', (def, parsedRequest) => {
    t.same(def, {
      behaviour: {
        ttl: 3,
      },
      operationName: 'me',
      operation: 'query',
      query: query,
    });

    if (parsedRequest.variables?.v1 === 'abc') {
      return;
    }

    return new ValidationError('not valid input');
  });

  const req = new Request('http://test.localhost?op=me&v=' + JSON.stringify({ v1: 'abcc' }), {
    method: 'GET',
  });
  const parseFn = createOperationParseFn(store);
  const { response } = await proxy(await parseFn(req), {
    ...defaultConfig,
    originFetch: async (_url, requestSpec) => {
      t.equal(requestSpec.query, query);
      return new Response('ok');
    },
  });

  t.equal(response.status, 400);
  t.same(await response.json(), { message: 'not valid input' });
});
