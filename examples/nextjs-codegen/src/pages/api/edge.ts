import { NextFetchEvent, NextRequest } from 'next/server';
import { createHandler, isParsedError } from '@graphql-edge/proxy';
import { createReportHooks, createReport, ReportContext } from '@graphql-edge/proxy/lib/reporting';
import {
  GeneratedOperation,
  OpsDef,
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

const reportHooks = createReportHooks();

type Context = ReportContext & { def: OpsDef | null };

const handler = createHandler('https://countries.trevorblades.com', createOperationParseFn(store), {
  hooks: {
    // use hook to assign data from parsed request to the context, which will be used for caching
    onRequestParsed(parsed, ctx: Context) {
      if (!isParsedError(parsed)) {
        ctx.def = parsed.def;
      }
      reportHooks.onRequestParsed(parsed, ctx);
    },
    onProxied: reportHooks.onProxied,
    onResponseParsed: reportHooks.onResponseParsed,
  },
});

export default async function MyEdgeFunction(request: NextRequest, event: NextFetchEvent) {
  event.passThroughOnException();
  const report = createReport();

  // this is mutable object
  const context: Context = Object.assign(report.context, {
    def: null,
  });
  const response = await handler(request, context);

  const cacheTTL = context.def?.behaviour.ttl;

  if (cacheTTL) {
    response.headers.set('Cache-Control', `public, s-maxage=${cacheTTL}, stale-while-revalidate=${cacheTTL}`);
  }

  event.waitUntil(
    report.collect(response, context).then((report) => {
      report && console.log({ report: JSON.stringify(report, null, 2) });
    })
  );

  return response;
}
