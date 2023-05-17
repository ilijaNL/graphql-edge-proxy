import { NextFetchEvent, NextRequest } from 'next/server';
import { Config, proxy } from '@graphql-edge/proxy';
import { createOperationParseFn, createOperationStore } from '@graphql-edge/proxy/lib/operations';

const proxyConfig: Config = {
  originURL: 'https://countries.trevorblades.com',
  // sha-256 hash of "pass-through"
  responseRules: {
    removeExtensions: true,
  },
};

const store = createOperationStore([
  {
    behaviour: {},
    operationName: 'me',
    operationType: 'query',
    query: `
    query me {  
      countries  {
        code
        name
        capital
        code
        emoji
        emojiU
        languages {code}
        states {code country{ continent { name code }}}
      } 
    }`,
  },
]);

const parseFn = createOperationParseFn(store);

export const config = {
  runtime: 'edge',
};

export default async function MyEdgeFunction(request: NextRequest, ctx: NextFetchEvent) {
  const time = Date.now();
  const parsedQuery = await parseFn(request);
  const { report, response } = await proxy(parsedQuery, proxyConfig);
  if (report) {
    ctx.waitUntil(
      Promise.resolve(report).then((d) => {
        // eslint-disable-next-line no-console
        console.log({
          status: d.originResponse?.status,
          duration: Date.now() - time,
        });
      })
    );
  }

  return response;
}
