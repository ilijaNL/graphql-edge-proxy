import { handler } from '@graphql-edge/proxy';

const proxyConfig = {
  maxTokens: 100,
  url: new URL('https://countries.trevorblades.com'),
  passThroughSecret: 'pass-through',
  secret: 'some-secret',
};

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    return handler(request, {
      ...proxyConfig,
      waitUntilReport(promise) {
        ctx.waitUntil(
          promise.then(async (report) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            console.log({ report });
          })
        );
      },
    });
  },
};
