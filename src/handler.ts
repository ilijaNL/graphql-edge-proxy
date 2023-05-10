import { parse, printNormalized } from './utils';
import { Headers, Response, Request, crypto } from '@whatwg-node/fetch';
import { DocumentNode } from 'graphql';
import { generateRandomSecretKey, hmacHex, webTimingSafeEqual } from './safe-compare';

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

async function getHMACFromQuery(stableQuery: string, secret: string) {
  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey('raw', secretKeyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  return hmacHex(key, encoder.encode(stableQuery));
}

export const defaultRules: Rules = {
  errorMasking: '[Suggestion hidden]',
  maxTokens: 500,
  removeExtensions: true,
  sign_secret: null,
  // maxDepth: 10,
};

export type Rules = {
  sign_secret: string | null;
  errorMasking: string | null;
  maxTokens: number;
  removeExtensions: boolean;
};

export type OperationReport = {
  /**
   * In ms
   */
  startTime: number;
  rules: Rules;
  originRequest: OriginRequest;
  /**
   * This response is cloned and can be easily consumed again by calling .json for example
   */
  originResponse: Response;
};

export type Config = {
  url: string;
  /**
   * Secret that can be used in header to avoid applying rules
   */
  passThroughSecret: string;
  rules: Partial<Rules>;

  fetchFn?: typeof fetch;
  /**
   * Fetch method which is used to fetch from origin.
   * Can be overriden to use cache
   */
  originFetch?: (requestSpec: OriginRequest) => Promise<Response>;
};

export const OPERATION_HEADER_KEY = 'x-operation-hash';
export const PASSTHROUGH_HEADER_KEY = 'x-proxy-passthrough';

export function getOperationHashFromHeader(req: Request) {
  return req.headers.get(OPERATION_HEADER_KEY);
}

export function getPassThroughSecretFromHeader(req: Request) {
  return req.headers.get(PASSTHROUGH_HEADER_KEY);
}

export type OriginRequest = {
  headers: Headers;
  document: DocumentNode;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type HandlerOptions = {};

function createInitialReport() {
  return {
    startTime: Date.now(),
  };
}

type InitialReport = ReturnType<typeof createInitialReport>;

function createReport(
  appliedRules: Rules,
  initialReport: InitialReport,
  originRequest: OriginRequest,
  clonedResponse: Response
): OperationReport {
  return {
    rules: appliedRules,
    originRequest: originRequest,
    originResponse: clonedResponse,
    startTime: initialReport.startTime,
  };
}

export function defaultOriginFetch(config: Config, request: Request, spec: OriginRequest, fetchFn: typeof fetch) {
  const newReq = new Request(config.url, {
    body: JSON.stringify({
      query: spec.query,
      variables: spec.variables,
      operationName: spec.operationName,
    }),
    method: request.method,
    headers: spec.headers,
  });

  return fetchFn(newReq);
}

export function createResponse(response: Response, report?: OperationReport): HandlerResponse {
  return {
    response: response,
    report,
  };
}

export type HandlerResponse = {
  response: Response;
  report?: OperationReport;
};

/**
 * Proxy function which does:
 * - Proxies through if not GET or POST method ELSE:
 *
 * 1. Validates if the body has query and is string
 * 2. Checks if signature is presented (if not passthrough)
 * 3. Prints document with max tokens in a normalized way
 * 4. Checks if signature matches the requested document (if not passthrough)
 * 5. Removes suggestions (if set)
 * 6. Removes extensions (if set)
 */
export async function handler(request: Request, config: Config): Promise<HandlerResponse> {
  const rules = Object.assign({}, defaultRules, config.rules);
  const passThroughSecret = config.passThroughSecret;

  const fetchFn = config.fetchFn ?? global.fetch ?? window.fetch;
  const fetchFromOrigin =
    config.originFetch ?? ((spec) => defaultOriginFetch({ ...config, rules }, request, spec, fetchFn));

  if (!(request.method === 'GET' || request.method === 'POST')) {
    return createResponse(await fetchFn(request));
  }

  const randomSecretFromTimingAttack = await generateRandomSecretKey();
  const passThroughHeaderValue = getPassThroughSecretFromHeader(request);
  const isPassThrough =
    passThroughHeaderValue &&
    (await webTimingSafeEqual(randomSecretFromTimingAttack, passThroughSecret, passThroughHeaderValue));

  const hashHeader = getOperationHashFromHeader(request);

  if (!isPassThrough && rules.sign_secret) {
    if (!hashHeader) {
      return createResponse(new Response('Invalid x-operation-hash header', { status: 403 }));
    }
  }

  const body = await request.json();

  // validate if query exissts on the payload
  if (!('query' in body || typeof body.query === 'string')) {
    return createResponse(new Response('Missing query in body', { status: 403 }));
  }

  let document: DocumentNode;
  try {
    document = parse(body.query, rules.maxTokens);
  } catch (e) {
    return createResponse(new Response('cannot parse query', { status: 403 }));
  }

  const stableQuery = printNormalized(document);

  if (!isPassThrough && rules.sign_secret) {
    const value = await getHMACFromQuery(stableQuery, rules.sign_secret);
    const verified = hashHeader !== null && (await webTimingSafeEqual(randomSecretFromTimingAttack, hashHeader, value));

    if (!verified) {
      return createResponse(new Response('Invalid x-operation-hash header', { status: 403 }));
    }
  }

  // pre proxy
  const headers = new Headers(request.headers);
  // since we generating new body ensure this header is not proxied through
  headers.delete('content-length');
  // nextjs edge functions doesnt like this header
  headers.delete('host');
  headers.set('content-type', 'application/json');

  const initialReport = createInitialReport();

  const originRequest = {
    document: document,
    headers: headers,
    query: body.query,
    operationName: body.operationName,
    variables: body.variables,
  };

  const originResponse = await fetchFromOrigin(originRequest);
  const report = createReport(rules, initialReport, originRequest, originResponse.clone());

  const contentType = originResponse.headers.get('content-type') ?? '';

  if (!originResponse.ok || !contentType.includes('application/json') || isPassThrough) {
    return createResponse(originResponse, report);
  }

  const payload = await originResponse.json();

  const errorMaskingRule = rules.errorMasking;

  // check if has errors
  if (errorMaskingRule && payload.errors && Array.isArray(payload.errors)) {
    payload.errors.forEach((e: any) => {
      maskError(e, errorMaskingRule);
    });
  }

  if (rules.removeExtensions) {
    delete payload['extensions'];
  }

  const response = new Response(JSON.stringify(payload), originResponse);

  // since we transformed stirng, delete this
  response.headers.delete('content-encoding');
  response.headers.set('content-type', 'application/json; charset=utf-8');

  return createResponse(response, report);
}
