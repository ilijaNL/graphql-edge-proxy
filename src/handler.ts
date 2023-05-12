import { parse, printNormalized } from './utils';
import { Headers, Response, Request, crypto } from '@whatwg-node/fetch';
import { DocumentNode } from 'graphql';
import { bufferToHex, generateRandomSecretKey, hmacHex, webTimingSafeEqual } from './safe-compare';

const ErrorRegex = /Did you mean ".+"/g;
/**
 * Masks the error message, creates new error if masked
 */
const maskError = (error: { message?: string }, mask: string) => {
  if (error.message) {
    return {
      ...error,
      message: error.message.replace(ErrorRegex, mask),
    };
  }

  return error;
};

function hasErrors(errors?: any[]): errors is any[] {
  return Boolean(errors) && Array.isArray(errors);
}

async function getHMACFromQuery(stableQuery: string, secret: string, algorithm: SignignAlgorithm) {
  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey('raw', secretKeyData, { name: 'HMAC', hash: algorithm }, false, ['sign']);

  return hmacHex(key, encoder.encode(stableQuery));
}

export const defaultRules: Rules = {
  errorMasking: '[Suggestion hidden]',
  maxTokens: 500,
  removeExtensions: true,
  sign_secret: null,
  // maxDepth: 10,
};

export type SignignAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export type Rules = {
  sign_secret:
    | string
    | null
    | {
        secret: string;
        /**
         * Algorithm that is used to create HMAC hash. Default is SHA-256.
         * Possible values "SHA-1", "SHA-256", "SHA-384", "SHA-512"
         */
        algorithm: SignignAlgorithm;
      };
  errorMasking: string | null;
  maxTokens: number;
  removeExtensions: boolean;
};

export type OperationReport = {
  timings: Timings;
  rules: Rules;
  /** GraphQL success */
  ok: boolean;
  /** Graphqly errors, if any */
  errors: Array<any> | null;
  originRequest: OriginRequest;
  /**
   * This response is cloned and can be easily consumed again by calling .json for example
   */
  originResponse: Response;
};

export type Config = {
  /**
   * GraphQL endpoint url
   */
  url: string;
  /**
   * Hash of the secret that can be used to avoid applying rules
   * It is compared against hashes sha-256 hex passthrough secret
   *
   * @Note: rule.maxTokens is always applied
   */
  passThroughHash: string;
  rules: Partial<Rules>;
  /**
   * Custom fetch function which can be used to override fetch
   */
  fetchFn?: typeof fetch;
  /**
   * Fetch method which is used to fetch from origin.
   * Can be overriden to use cache
   */
  originFetch?: (requestSpec: OriginRequest) => Promise<Response>;
  /**
   * Function which can be used to override default behaviour to check if the incoming request is a passtrhough request
   */
  isPassthroughRequest?: (incomingRequest: Request, config: Config) => Promise<boolean>;
};

export const OPERATION_HEADER_KEY = 'x-proxy-op-hash';
export const PASSTHROUGH_HEADER_KEY = 'x-proxy-pass-secret';

export function getOperationHashFromHeader(req: Request) {
  return req.headers.get(OPERATION_HEADER_KEY);
}

export function getPassThroughSecretFromHeader(req: Request) {
  return req.headers.get(PASSTHROUGH_HEADER_KEY);
}

export type OriginRequest = {
  headers: Headers;
  document: DocumentNode;
  isPassThrough: boolean;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type HandlerOptions = {};

export type Timings = {
  /**
   * Time when incoming request is started parsing the body
   */
  input_start_parsing: number;
  /**
   * Time when the incoming request's body is end parsing, after await request.json()
   */
  input_end_parsing: number;
  /**
   * Time when the incoming document is ended parsing
   */
  document_end_parsing: number;
  /**
   * Time when request is send to the origin server
   */
  origin_start_request: number;
  /**
   * Time when response is received from origin server
   */
  origin_end_request: number;
  /**
   * Time when response is parsed from origin server, after await requestOrigin.json()
   */
  origin_end_parsing_request: number | null;
};

function createReport(
  appliedRules: Rules,
  originRequest: OriginRequest,
  clonedResponse: Response,
  ok: boolean,
  errors: Array<any> | null,
  timings: Timings
): OperationReport {
  return { errors, ok, rules: appliedRules, originRequest: originRequest, originResponse: clonedResponse, timings };
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

export async function isPassthroughRequest(request: Request, passThroughHash: string) {
  const passThroughHeaderValue = getPassThroughSecretFromHeader(request);
  if (!passThroughHeaderValue) {
    return false;
  }

  const passThroughHashFromHeader = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(passThroughHeaderValue)
  );

  return passThroughHash === bufferToHex(passThroughHashFromHeader);
}

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

  const fetchFn = config.fetchFn ?? global.fetch ?? window.fetch;
  const finalConfig = { ...config, rules };
  const fetchFromOrigin =
    config.originFetch ?? ((spec) => defaultOriginFetch({ ...config, rules }, request, spec, fetchFn));

  if (!(request.method === 'GET' || request.method === 'POST')) {
    return createResponse(await fetchFn(request));
  }

  const isPassThrough = await (finalConfig.isPassthroughRequest
    ? finalConfig.isPassthroughRequest(request, finalConfig)
    : isPassthroughRequest(request, finalConfig.passThroughHash));

  const hashHeader = getOperationHashFromHeader(request);

  if (!isPassThrough && rules.sign_secret) {
    if (!hashHeader) {
      return createResponse(new Response(`Invalid ${OPERATION_HEADER_KEY} header`, { status: 403 }));
    }
  }

  const input_start_parsing = Date.now();

  let body: any = await request.text();

  try {
    body = JSON.parse(body);
  } catch (e) {
    return createResponse(new Response('not valid body', { status: 406 }));
  }

  const input_end_parsing = Date.now();

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
    const secret = typeof rules.sign_secret === 'string' ? rules.sign_secret : rules.sign_secret.secret;
    const algo = typeof rules.sign_secret === 'object' ? rules.sign_secret.algorithm : 'SHA-256';

    const [randomSecretForTimingAttack, value] = await Promise.all([
      generateRandomSecretKey(),
      getHMACFromQuery(stableQuery, secret, algo),
    ]);
    const verified = hashHeader !== null && (await webTimingSafeEqual(randomSecretForTimingAttack, hashHeader, value));

    if (!verified) {
      return createResponse(new Response(`Invalid ${OPERATION_HEADER_KEY} header`, { status: 403 }));
    }
  }

  const document_end_parsing = Date.now();

  // pre proxy
  const headers = new Headers(request.headers);
  // since we generating new body ensure this header is not proxied through
  headers.delete('content-length');
  // nextjs edge functions doesnt like this header
  headers.delete('host');
  headers.set('content-type', 'application/json');

  const origin_start_request = Date.now();

  const originRequest: OriginRequest = {
    document: document,
    isPassThrough: isPassThrough,
    headers: headers,
    query: body.query,
    operationName: body.operationName,
    variables: body.variables,
  };

  const originResponse = await fetchFromOrigin(originRequest);

  const timings: Timings = {
    document_end_parsing,
    input_end_parsing,
    input_start_parsing,
    origin_end_request: Date.now(),
    origin_start_request,
    origin_end_parsing_request: null,
  };

  const report = createReport(rules, originRequest, originResponse.clone(), false, null, timings);

  const contentType = originResponse.headers.get('content-type') ?? '';

  if (
    !originResponse.ok ||
    !(contentType.includes('application/json') || contentType.includes('application/graphql-response+json'))
  ) {
    return createResponse(originResponse, report);
  }

  const payload: { data?: any; errors?: any[]; extensions?: any } = await originResponse.json();

  // modify this since we done parsing the origin request
  timings.origin_end_parsing_request = Date.now();

  const errors = payload.errors;

  report.errors = errors ?? null;
  const _hasErrors = hasErrors(errors);
  report.ok = _hasErrors ? errors.length === 0 : true;

  const errorMaskingRule = rules.errorMasking;

  // check if has errors
  if (!isPassThrough && errorMaskingRule && _hasErrors) {
    payload.errors = errors.map((e: any) => maskError(e, errorMaskingRule));
  }

  if (!isPassThrough && rules.removeExtensions) {
    delete payload['extensions'];
  }

  const response = new Response(JSON.stringify(payload), originResponse);

  // since we transformed stirng, delete this
  response.headers.delete('content-encoding');
  response.headers.set('content-type', 'application/json; charset=utf-8');

  return createResponse(response, report);
}
