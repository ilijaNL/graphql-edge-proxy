import tap from 'tap';
import { Config, proxy } from '../src';
import { Headers, Response, Request } from '@whatwg-node/fetch';

const defaultConfig: Config = {
  originURL: 'http://app.localhost',
  // url: 'http://app.localhost',
  // passThroughHash: crypto.createHash('sha256').update(defaultPassThroughSecret).digest('hex'),
  responseRules: {
    errorMasking: '[Suggestion hidden]',
    removeExtensions: true,
  },
};

tap.test('not valid response from origin', async (t) => {
  const q = 'query me { me }';
  const req = new Request('http://test.localhost', {
    method: 'POST',
    body: JSON.stringify({
      query: q,
    }),
  });

  const { response: resp, report } = await proxy(
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
  // test report correctness
  t.equal(report?.timings.origin_end_parsing_request, undefined);
  t.equal(report?.ok, false);
  t.equal(report?.errors, undefined);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  t.equal(report?.originResponse!.status, 200);
  t.ok(report?.timings.origin_end_request);
  t.ok(report?.timings.origin_start_request);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  t.ok(report!.timings.origin_start_request! < report!.timings.origin_end_request!);
});

tap.test('error masking', async (t) => {
  const query = 'query me {me}';
  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({}),
    body: JSON.stringify({
      query: query,
    }),
  });

  const { response: resp, report } = await proxy(
    { headers: req.headers, query: query },
    {
      ...defaultConfig,
      originFetch: async () =>
        new Response(
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
        ),
    }
  );
  t.equal(resp.status, 200);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  t.equal(report!.ok, false);
  t.same(report?.errors, [
    {
      message: 'Did you mean "Type ABC"',
    },
    {
      message: 'Did you mean "Type ABC"',
    },
  ]);

  const response = await resp.json();
  t.same(response.errors, [{ message: '[Suggestion hidden]' }, { message: '[Suggestion hidden]' }]);
});

tap.test('creates operation report', async (t) => {
  const query = 'query me {me}';

  const req = new Request('http://test.localhost', {
    method: 'POST',
    headers: new Headers({}),
    body: JSON.stringify({
      query: query,
    }),
  });

  const { response: resp, report } = await proxy(
    {
      headers: req.headers,
      query: query,
    },
    {
      ...defaultConfig,
      async originFetch() {
        await new Promise((resolve) => setTimeout(resolve, 10));
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
    }
  );

  t.equal(resp.status, 200);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const reportData = await report?.originResponse!.json();
  t.same(reportData, { data: { me: 'me' }, errors: [] });

  t.ok(report?.timings);
  t.ok(report?.timings.origin_end_parsing_request);
  t.equal(report?.ok, true);
  t.same(report?.errors, []);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  t.ok(report!.timings.origin_start_request! < report!.timings.origin_end_parsing_request!);

  const response = await resp.json();
  t.same(response.errors, []);
  t.same(response.data, { me: 'me' });
});

tap.test('no rules', async (t) => {
  const query = 'query me {me}';

  const { response: resp, report } = await proxy(
    {
      headers: new Headers({}),
      query: query,
    },
    {
      ...defaultConfig,
      responseRules: undefined,
      async originFetch() {
        await new Promise((resolve) => setTimeout(resolve, 10));
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
    }
  );

  t.equal(resp.status, 200);

  t.equal(report.appliedRules, undefined);
  t.equal(report.errors, undefined);
  t.equal(report.ok, true);
  const response = await resp.json();
  t.same(response.errors, []);
  t.same(response.data, { me: 'me' });
});
