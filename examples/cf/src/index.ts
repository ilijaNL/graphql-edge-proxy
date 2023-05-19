import { createHandler } from '@graphql-edge/proxy';
import { createSignatureParseFn } from '@graphql-edge/proxy/lib/signature';
import { createReportHooks, createReport, ReportContext } from '@graphql-edge/proxy/lib/reporting';

// signature parse fn
const parseFn = createSignatureParseFn({
  maxTokens: 1000,
  // sha-256 hash of "pass-through"
  passThroughHash: '14652aa39beeaf35b41963fdcda76c67023bcb6339f91f0c7f8177c7f7a3193b',
  signSecret: 'some-secret',
});

const reportHooks = createReportHooks();

const handler = createHandler<ReportContext>('https://countries.trevorblades.com', parseFn, {
  hooks: reportHooks,
});

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();
    const { collect, context } = createReport();
    const response = await handler(request, context);

    ctx.waitUntil(
      collect(response).then((report) => {
        console.log({ report: JSON.stringify(report, null, 2) });
      })
    );

    return response;
  },
};
