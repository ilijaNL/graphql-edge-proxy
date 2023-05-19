import { NextFetchEvent, NextRequest } from 'next/server';
import { createHandler } from '@graphql-edge/proxy';
import { createReportHooks, createReport, ReportContext } from '@graphql-edge/proxy/lib/reporting';
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

const reportHooks = createReportHooks();

const handler = createHandler<ReportContext>('https://countries.trevorblades.com', createOperationParseFn(store), {
  hooks: reportHooks,
});

export default async function MyEdgeFunction(request: NextRequest, ctx: NextFetchEvent) {
  ctx.passThroughOnException();
  const { collect, context } = createReport();
  const response = await handler(request, context);

  ctx.waitUntil(
    collect(response).then((report) => {
      console.log({ report: JSON.stringify(report, null, 2) });
    })
  );

  return response;
}
