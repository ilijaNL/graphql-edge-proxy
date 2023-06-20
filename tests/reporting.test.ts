import tap from 'tap';
import { createReportCollector, kReportParsed, kReportProxy, kReportResponse } from '../src/reporting';
import { Headers, Response } from '@whatwg-node/fetch';
import { createErrorResponse, createParseError } from '../src';

tap.test('happy path', async (t) => {
  const report = createReportCollector();

  t.same(report.context, {
    [kReportParsed]: null,
    [kReportProxy]: null,
    [kReportResponse]: null,
  });

  report.onProxied(new Response());

  report.onRequestParsed({ headers: new Headers(), query: 'q', operationName: 'op1', variables: { v1: true } });

  report.onResponseParsed({
    data: [],
  });

  const respPayload = Buffer.from(
    JSON.stringify({
      data: { me: 'me' },
      errors: [],
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const collected = (await report.collect(
    new Response(respPayload, {
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
    })
  ))!;

  t.same(collected.inputSize, Buffer.from(JSON.stringify({ v1: true })).byteLength);
  t.same(collected.ok, true);
  t.same(collected.response_size, respPayload.byteLength);
  t.same(collected.operationName, 'op1');
  t.same(collected.originStatus, 200);
  t.ok(
    collected.durations.total >=
      collected.durations.parsing + collected.durations.processing + collected.durations.proxying
  );
});

tap.test('parse error', async (t) => {
  const report = createReportCollector();

  t.same(report.context, {
    [kReportParsed]: null,
    [kReportProxy]: null,
    [kReportResponse]: null,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  const respPayload = Buffer.from(
    JSON.stringify({
      data: { me: 'me' },
      errors: [],
    })
  );

  report.onRequestParsed(createParseError(404, 'test'));

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const collected = (await report.collect(
    new Response(respPayload, {
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
    })
  ))!;

  t.equal(collected.ok, false);
  t.equal(collected.response_size, respPayload.byteLength);
  t.equal(collected.durations.processing, 0);
  t.equal(collected.durations.proxying, 0);
  t.ok(collected.durations.total >= 10);
  t.equal(collected.inputSize, 0);
  t.same(collected.errors, [{ message: 'cannot parse: test' }]);
  t.same(collected.query, undefined);
  t.same(collected.operationName, undefined);
});

tap.test('no hooks called', async (t) => {
  const report = createReportCollector();

  t.same(report.context, {
    [kReportParsed]: null,
    [kReportProxy]: null,
    [kReportResponse]: null,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  const respPayload = Buffer.from(
    JSON.stringify({
      data: { me: 'me' },
      errors: [],
    })
  );

  const collected = await report.collect(
    new Response(respPayload, {
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
    })
  );

  t.equal(collected, null);
});

tap.test('happy path with http errors', async (t) => {
  const report = createReportCollector();

  report.onProxied(createErrorResponse('not-found', 500));

  report.onRequestParsed({ headers: new Headers(), query: 'q', operationName: 'op1', variables: { v1: true } });

  report.onResponseParsed({
    data: [],
  });

  const resp = createErrorResponse('not-found', 500);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const collected = (await report.collect(resp))!;

  t.same(collected.ok, false);
  t.same(collected.operationName, 'op1');
  t.same(collected.originStatus, 500);
  t.same(collected.errors, [{ message: 'not-found' }]);
});

tap.test('happy path with response_map', async (t) => {
  const report = createReportCollector();

  report.onProxied(new Response());

  report.onRequestParsed({ headers: new Headers(), query: 'q', operationName: 'op1', variables: { v1: true } });

  const data = {
    itemA: {
      test: null,
      testb: undefined,
      test3: 0,
    },
    emptyArr: [],
    arr: [
      {
        w: null,
        test: 'abc',
      },
      {
        d: 'd',
        test: 'abc',
      },
    ],
  };

  report.onResponseParsed({
    data: data,
  });

  const respPayload = Buffer.from(
    JSON.stringify({
      data: data,
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const collected = (await report.collect(
    new Response(respPayload, {
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
      }),
    })
  ))!;

  t.same(collected.ok, true);
  t.same(collected.response_size, respPayload.byteLength);
  t.same(collected.operationName, 'op1');
  t.same(collected.originStatus, 200);
  t.same(collected.response_map, {
    '$.itemA.test': 1,
    '$.itemA.test3': 1,
    '$.emptyArr': 0,
    '$.arr': 2,
    '$.arr.w': 1,
    '$.arr.test': 2,
    '$.arr.d': 1,
  });
});
