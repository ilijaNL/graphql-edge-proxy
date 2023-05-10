import { Config, handler } from '@graphql-edge/proxy';

const proxyConfig: Config = {
  url: 'https://countries.trevorblades.com',
  passThroughSecret: 'pass-through',
  rules: {
    sign_secret: 'some-secret',
    maxTokens: 100,
    removeExtensions: true,
  },
};

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const { report, response } = await handler(request, proxyConfig);
    if (report) {
      ctx.waitUntil(
        Promise.resolve(report).then((d) => {
          console.log({
            status: d.originResponse.status,
            duration: Date.now() - report.startTime,
            headers: d.originResponse.headers,
          });
        })
      );
    }

    return response;
  },
};
