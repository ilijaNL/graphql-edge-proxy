import { parse, printNormalized } from './utils';
import { InitialReport, OperationReport, createInitialReport, finishReport } from './report';
import { Headers, Response, Request, crypto } from '@whatwg-node/fetch';
import { DocumentNode } from 'graphql';

function bufferToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ErrorRegex = /Did you mean ".+"/g;
/**
 * Masks the error message, this mutates the original object
 */
const maskError = (error: { message?: string }, mask: string) => {
  if (error.message) {
    error.message = error.message.replace(ErrorRegex, mask);
  }

  return error;
};

async function isVerified(stableQuery: string, secret: string, hashHeader: string | null) {
  if (hashHeader === null) {
    return false;
  }

  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const signer = await crypto.subtle.importKey('raw', secretKeyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

  const signedQuery = await crypto.subtle.sign('HMAC', signer, encoder.encode(stableQuery));
  const hashedHex = bufferToHex(signedQuery);

  return hashedHex === hashHeader;
}

export type Config = {
  url: URL;
  secret: string;
  passThroughSecret: string;
  maxTokens?: number;
  fetchFn?: typeof fetch;
  /**
   * Fetch method which is used to fetch from origin.
   * Can be overriden to use cache
   */
  originFetch?: (requestSpec: OriginRequest) => Promise<Response>;

  /**
   * Function which is triggered when waiting for report
   * Use this with waitFor to read the report and possible log
   */
  waitUntilReport?: (promise: Promise<OperationReport | null>) => void;
};

const OPERATION_HEADER_KEY = 'x-operation-hash';
const PASSTHROUGH_HEADER_KEY = 'x-proxy-passthrough';

export type OriginRequest = {
  isPassThrough: boolean;
  headers: Headers;
  consumedRequest: Request;
  config: Config;
  document: DocumentNode;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type HandlerOptions = {};

async function createReport(clonedResponse: Response, initialReport: InitialReport) {
  const result = await clonedResponse.json();
  const report = finishReport(initialReport, result);
  return report;
}

export function defaultOriginFetch(spec: OriginRequest, fetchFn: typeof fetch) {
  const newReq = new Request(spec.config.url, {
    body: JSON.stringify({
      query: spec.query,
      variables: spec.variables,
      operationName: spec.operationName,
    }),
    method: spec.consumedRequest.method,
    headers: spec.headers,
  });

  return fetchFn(newReq);
}

/**
 * Proxy function which does:
 * - Proxies through if not GET or POST method ELSE:
 *
 * 1. Validates if the body has query and is string
 * 2. Checks if signature is presented (if not passthrough)
 * 3. Prints document with max tokens in a normalized way
 * 4. Checks if signature matches the requested document (if not passthrough)
 * 5. Removes suggestions
 */
export async function handler(request: Request, config: Config): Promise<Response> {
  const fetchFn = config.fetchFn ?? global.fetch ?? window.fetch;
  const fetchFromOrigin = config.originFetch ?? ((spec) => defaultOriginFetch(spec, fetchFn));

  // only accepts GET or POST
  if (!(request.method === 'GET' || request.method === 'POST')) {
    return fetchFn(request);
  }

  const passThroughHeader = request.headers.get(PASSTHROUGH_HEADER_KEY);
  const isPassThrough = config.passThroughSecret === passThroughHeader;
  const hashHeader = request.headers.get(OPERATION_HEADER_KEY);

  if (!hashHeader && !isPassThrough) {
    return new Response('Invalid x-operation-hash header', { status: 403 });
  }

  const body = await request.json();

  if (!('query' in body || typeof body.query === 'string')) {
    return new Response('Missing query in body', { status: 403 });
  }

  let document: DocumentNode;
  try {
    document = parse(body.query, config.maxTokens);
  } catch (e) {
    return new Response('cannot parse query', { status: 403 });
  }

  const stableQuery = printNormalized(document);

  const verified = isPassThrough || (await isVerified(stableQuery, config.secret, hashHeader));

  if (!verified) {
    // introduce some randomness to avoid timed hmac attack
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 50) / 10));
    return new Response('Invalid x-operation-hash header', { status: 403 });
  }

  const headers = new Headers(request.headers);
  // since we generating new body ensure this header is not proxied through
  headers.delete('content-length');
  // nextjs edge functions doesnt like this header
  headers.delete('host');

  headers.set('content-type', 'application/json');

  const initialReport = createInitialReport(stableQuery, body.variables);

  const originResponse = await fetchFromOrigin({
    isPassThrough: isPassThrough,
    consumedRequest: request,
    document: document,
    headers: headers,
    config: config,
    query: body.query,
    operationName: body.operationName,
    variables: body.variables,
  });

  const contentType = originResponse.headers.get('content-type') ?? '';

  /* Check if response is json, so valid graphql, if not, just return */
  if (!contentType.includes('application/json')) {
    return originResponse;
  }

  if (config.waitUntilReport) {
    config.waitUntilReport(
      createReport(originResponse.clone(), initialReport).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('onReport failed', e);
        return null;
      })
    );
  }

  // dont do error masking when passthrough
  if (isPassThrough) {
    return originResponse;
  }

  const payload = await originResponse.json();

  // check if has errors
  if (payload.errors && Array.isArray(payload.errors)) {
    payload.errors.forEach((e: any) => {
      maskError(e, '[Suggestion hidden]');
    });
  }

  const response = new Response(JSON.stringify(payload), originResponse);

  // since we transformed stirng, delete this
  response.headers.delete('content-encoding');
  response.headers.set('content-type', 'application/json; charset=utf-8');

  return response;
}
