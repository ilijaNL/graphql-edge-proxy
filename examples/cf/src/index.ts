import { Config, proxy } from '@graphql-edge/proxy';
import { createSignatureParseFn } from '@graphql-edge/proxy/lib/signature';

const proxyConfig: Config = {
  originURL: 'https://countries.trevorblades.com',
  responseRules: {
    removeExtensions: true,
  },
};

// signature parse fn
const parseFn = createSignatureParseFn({
  maxTokens: 1000,
  // sha-256 hash of "pass-through"
  passThroughHash: '14652aa39beeaf35b41963fdcda76c67023bcb6339f91f0c7f8177c7f7a3193b',
  signSecret: 'some-secret',
});

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const parsedReq = await parseFn(request);
    const { report, response } = await proxy(parsedReq, proxyConfig);
    if (report) {
      ctx.waitUntil(
        Promise.resolve(report).then((d) => {
          // eslint-disable-next-line no-console
          console.log({
            status: d.originResponse?.status,
            duration: Date.now() - report.timings.origin_start_request,
          });
        })
      );
    }

    return response;
  },
};
