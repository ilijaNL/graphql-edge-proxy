import { NextFetchEvent, NextRequest } from 'next/server';
import { createErrorResponse, createGraphQLProxy, createParseErrorResponse, isParsedError } from '@graphql-edge/proxy';
import { ReportCollector, createReportCollector } from '@graphql-edge/proxy/lib/reporting';
import {
  GeneratedOperation,
  ValidationError,
  createOperationParseFn,
  createOperationStore,
} from '@graphql-edge/proxy/lib/operations';
import type { VariablesOf } from '@graphql-typed-document-node/core';
import type { GetCountryDocument } from '../../__generated__/gql';
import OperationList from '../../__generated__/operations.json';

const store = createOperationStore(OperationList as Array<GeneratedOperation>);

store.setValidateFn<VariablesOf<typeof GetCountryDocument>>('getCountry', (_, parsedReq) => {
  if (!parsedReq.variables?.countryCode || parsedReq.variables?.countryCode.length < 2) {
    return new ValidationError('not valid input');
  }
});

export const config = {
  runtime: 'edge',
};

const proxy = createGraphQLProxy('https://countries.trevorblades.com', createOperationParseFn(store), {});

const handle = async (request: Request, collector: ReportCollector) => {
  const parsed = await proxy.parseRequest(request);

  collector?.onRequestParsed(parsed);

  if (isParsedError(parsed)) {
    return createParseErrorResponse(parsed);
  }

  const proxyResponse = await proxy.proxy(parsed);
  collector?.onProxied(proxyResponse);
  if (!proxyResponse.ok) {
    return proxyResponse;
  }

  const parsedResult = await proxy.parseResponse(proxyResponse);

  if (!parsedResult) {
    return createErrorResponse('cannot parse response', 406);
  }

  collector?.onResponseParsed(parsedResult);

  const response = await proxy.formatResponse(parsedResult, proxyResponse);

  const cacheTTL = parsed.def?.behaviour.ttl;

  if (cacheTTL) {
    response.headers.set('Cache-Control', `public, s-maxage=${cacheTTL}, stale-while-revalidate=${cacheTTL}`);
  }

  return response;
};

export default async function MyEdgeFunction(request: NextRequest, event: NextFetchEvent) {
  event.passThroughOnException();
  const collector = createReportCollector();
  const response = await handle(request, collector);

  event.waitUntil(
    collector.collect(response).then((report) => {
      // eslint-disable-next-line no-console
      report && console.log({ report: JSON.stringify(report, null, 2) });
    })
  );

  return response;
}
