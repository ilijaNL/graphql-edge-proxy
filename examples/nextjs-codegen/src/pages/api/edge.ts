import { NextFetchEvent, NextRequest } from 'next/server';

import { Config, handler } from '@graphql-edge/proxy';

const proxyConfig: Config = {
  url: 'https://countries.trevorblades.com',
  // sha-256 hash of "pass-through"
  passThroughHash: '14652aa39beeaf35b41963fdcda76c67023bcb6339f91f0c7f8177c7f7a3193b',
  rules: {
    sign_secret: 'some-secret',
    maxTokens: 100,
    removeExtensions: true,
  },
};

export const config = {
  runtime: 'edge',
};

export default async function MyEdgeFunction(request: NextRequest, ctx: NextFetchEvent) {
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
}
