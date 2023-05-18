import { fetch, Request, Response, Headers } from '@whatwg-node/fetch';

export type ParsedRequest<Vars = Record<string, any>> = {
  query: string;
  operationName?: string;
  variables?: Vars;
  headers: Headers;
};

export const errorCodeSymbol = Symbol('errorCode');
export const errorMessageSymbol = Symbol('errorMessage');

export type ParsedError = {
  [errorCodeSymbol]: number;
  [errorMessageSymbol]: string;
};

export const createError = (code: number, message: string): ParsedError => {
  return {
    [errorCodeSymbol]: code,
    [errorMessageSymbol]: message,
  };
};

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

export type OriginRequestFn = (url: string, requestSpec: ParsedRequest) => Promise<Response>;

const defaultOriginRequest: OriginRequestFn = (url, request) => {
  const newReq = new Request(url, {
    body: JSON.stringify({
      query: request.query,
      variables: request.variables,
      operationName: request.operationName,
    }),
    method: 'POST',
    headers: request.headers,
  });

  return fetch(newReq);
};

export type Config = {
  /**
   * Query store.
   * use `createQueryStore` to create a store from generated operations
   */
  // store: QueryStore;
  /**
   * The origin graphql url
   */
  originURL: string;
  /**
   *
   */
  originFetch?: OriginRequestFn;
  /**
   * Rules that are applied when to the response
   */
  responseRules?: Partial<{
    /**
     * Remove the extensions from the origin response
     */
    removeExtensions: boolean;
    /**
     * Mask errors
     */
    errorMasking: string | null;
  }>;
};

export type Report = {
  timings: {
    origin_start_request?: number;
    origin_end_request?: number;
    origin_end_parsing_request?: number;
  };
  originResponse?: Response;
  originRequest?: ParsedRequest;
  ok: boolean;
  errors?: Array<{ message: string } & Record<string, any>>;
  appliedRules?: Partial<Config['responseRules']>;
};

export type HandlerResponse = {
  response: Response;
  report: Report;
};

export function createErrorResponse(report: Report, message: string, code: number): HandlerResponse {
  report.errors = [{ message: message, code }];
  return {
    report: report,
    response: new Response(
      JSON.stringify({
        message: message,
      }),
      { status: code }
    ),
  };
}

function hasErrors(errors?: any[]): errors is any[] {
  return Boolean(errors) && Array.isArray(errors);
}

//
export const applyForwardedHeaders = (requestHeaders: Headers): void => {
  if (!requestHeaders.get('X-Forwarded-Proto')) {
    requestHeaders.set('X-Forwarded-Proto', 'https');
  }

  const host = requestHeaders.get('Host');
  if (host !== null) {
    requestHeaders.set('X-Forwarded-Host', host);
  }

  const ip = requestHeaders.get('cf-connecting-ip') ?? requestHeaders.get('x-real-ip');

  const forwardedForHeader = requestHeaders.get('X-Forwarded-For');
  if (ip !== null && forwardedForHeader === null) {
    requestHeaders.set('X-Forwarded-For', ip);
  }
};

export async function proxy(parsedRequest: ParsedRequest | ParsedError, config: Config): Promise<HandlerResponse> {
  const report: Report = {
    timings: {},
    ok: false,
  };

  // probably shoud use symbol here
  if (errorCodeSymbol in parsedRequest) {
    return createErrorResponse(report, parsedRequest[errorMessageSymbol], parsedRequest[errorCodeSymbol]);
  }

  const requestHeaders = new Headers(parsedRequest.headers);

  // delete headers

  requestHeaders.set('origin', new URL(config.originURL).origin);
  requestHeaders.set('content-type', 'application/json');

  // set forwarded headers
  applyForwardedHeaders(requestHeaders);

  // we are modifying the request
  requestHeaders.delete('content-length');
  requestHeaders.delete('content-encoding');
  // remove this since it will be set by the underlying agent
  requestHeaders.delete('host');

  const originRequest: ParsedRequest = {
    query: parsedRequest.query,
    operationName: parsedRequest.operationName,
    variables: parsedRequest.variables,
    headers: requestHeaders,
  };

  report.originRequest = originRequest;
  report.timings.origin_start_request = Date.now();

  const originResponse = await (config.originFetch?.(config.originURL, originRequest) ??
    defaultOriginRequest(config.originURL, originRequest));

  const contentType = originResponse.headers.get('content-type') ?? '';

  report.originResponse = originResponse.clone();
  report.timings.origin_end_request = Date.now();

  if (
    !originResponse.ok ||
    !(contentType.includes('application/json') || contentType.includes('application/graphql-response+json'))
  ) {
    return {
      report: report,
      response: originResponse,
    };
  }

  const rules = config.responseRules;

  if (!rules) {
    // we don't know actually
    report.ok = originResponse.ok;
    return {
      report: report,
      response: originResponse,
    };
  }

  const payload: { data?: any; errors?: any[]; extensions?: any } = await originResponse.json();

  const errors = payload.errors;

  const _hasErrors = hasErrors(errors);
  const errorMaskingRule = rules.errorMasking;

  report.timings.origin_end_parsing_request = Date.now();
  report.appliedRules = {};
  report.ok = _hasErrors ? errors.length === 0 : false;
  report.errors = _hasErrors ? errors : undefined;

  // check if has errors
  if (errorMaskingRule && _hasErrors) {
    report.appliedRules.errorMasking = errorMaskingRule;
    payload.errors = errors.map((e: any) => maskError(e, errorMaskingRule));
  }

  if (rules.removeExtensions) {
    report.appliedRules.removeExtensions = rules.removeExtensions;
    delete payload['extensions'];
  }

  const response = new Response(JSON.stringify(payload), originResponse);

  // since we transformed the resulted payload, delete this
  response.headers.delete('content-encoding');
  response.headers.delete('content-length');

  response.headers.set('content-type', 'application/json; charset=utf-8');

  return {
    report: report,
    response: response,
  };
}
