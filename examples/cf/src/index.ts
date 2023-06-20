import { createHandler } from '@graphql-edge/proxy';
import { createSignatureParseFn } from '@graphql-edge/proxy/lib/signature';
import { createReportCollector } from '@graphql-edge/proxy/lib/reporting';

// signature parse fn
const parseFn = createSignatureParseFn({
  maxTokens: 1000,
  // sha-256 hash of "pass-through"
  passThroughHash: '14652aa39beeaf35b41963fdcda76c67023bcb6339f91f0c7f8177c7f7a3193b',
  signSecret: 'some-secret',
});

const handler = createHandler('https://countries.trevorblades.com', parseFn, {});

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();
    const reportCollector = createReportCollector();
    const response = await handler(request, reportCollector);

    ctx.waitUntil(
      reportCollector.collect(response).then((report) => {
        // eslint-disable-next-line no-console
        report && console.log({ report: JSON.stringify(report, null, 2) });
      })
    );

    return response;
  },
};
