import { NextFetchEvent, NextRequest } from 'next/server';
import { Config, proxy } from '@graphql-edge/proxy';
import {
  GeneratedOperation,
  ValidationError,
  createOperationParseFn,
  createOperationStore,
} from '@graphql-edge/proxy/lib/operations';
import type { VariablesOf } from '@graphql-typed-document-node/core';
import type { GetCountryDocument } from '../../__generated__/gql';
import OperationList from '../../__generated__/operations.json';

const proxyConfig: Config = {
  originURL: 'https://countries.trevorblades.com',
  // sha-256 hash of "pass-through"
  responseRules: {
    removeExtensions: true,
  },
};

const store = createOperationStore(OperationList as Array<GeneratedOperation>);

store.setValidateFn<VariablesOf<typeof GetCountryDocument>>('getCountry', (_, parsedReq) => {
  if (!parsedReq.variables?.countryCode || parsedReq.variables?.countryCode.length < 2) {
    return new ValidationError('not valid input');
  }
});

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
