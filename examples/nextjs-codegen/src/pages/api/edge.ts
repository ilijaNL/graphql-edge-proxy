import { handler } from '@graphql-edge/proxy';
import { NextFetchEvent, NextRequest } from 'next/server';

const proxyConfig = {
  maxTokens: 100,
  url: new URL('https://countries.trevorblades.com'),
  passThroughSecret: 'pass-through',
  secret: 'some-secret',
};

export const config = {
  runtime: 'edge',
};

export default function MyEdgeFunction(request: NextRequest, context: NextFetchEvent) {
  return handler(request, {
    ...proxyConfig,
    waitUntilReport(promise) {
      context.waitUntil(
        promise.then((report) => {
          console.log({ report });
        })
      );
    },
  });
}
