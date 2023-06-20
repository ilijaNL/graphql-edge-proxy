import { fetch, Request, Response, Headers } from '@whatwg-node/fetch';
import { ReportCollector } from './reporting';

export type ParsedRequest<Vars = Record<string, any>> = {
  query: string;
  operationName?: string;
  variables?: Vars;
  headers: Headers;
};

export function isParsedError(parsed: ParsedRequest | ParsedError): parsed is ParsedError {
  if (errorCodeSymbol in parsed) {
    return true;
  }

  return false;
}

export const errorCodeSymbol = Symbol('errorCode');
export const errorMessageSymbol = Symbol('errorMessage');

export type ParsedError = {
  [errorCodeSymbol]: number;
  [errorMessageSymbol]: string;
};

export const createParseError = (code: number, message: string): ParsedError => {
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

export type ProxyConfig = {
  /**
   * The origin graphql url
   */
  originURL: string;
  /**
   *
   */
  originFetch?: OriginRequestFn;
};

export function createParseErrorResponse(error: ParsedError) {
  return createErrorResponse(error[errorMessageSymbol], error[errorCodeSymbol]);
}

export function createErrorResponse(message: string, code: number): Response {
  const headers = new Headers([['content-type', 'application/json']]);
  return new Response(
    JSON.stringify({
      message: message,
    }),
    { status: code, headers }
  );
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

export type ParseOptions = {
  errorMasking: string;
  removeExtensions: boolean;
};

/**
 * Parse the origin response and apply some parsing options
 */
export async function parseOriginResponse(
  gqlResponse: OriginGraphQLResponse,
  originResponse: Response,
  parseOptions?: Partial<ParseOptions>
): Promise<Response> {
  const errors = gqlResponse.errors;

  const _hasErrors = hasErrors(errors);
  const errorMaskingRule = parseOptions?.errorMasking;

  // check if has errors
  if (errorMaskingRule && _hasErrors) {
    gqlResponse.errors = errors.map((e: any) => maskError(e, errorMaskingRule));
  }

  if (parseOptions?.removeExtensions === true && gqlResponse['extensions']) {
    delete gqlResponse['extensions'];
  }

  const resultHeader = new Headers(originResponse.headers);

  resultHeader.delete('content-encoding');
  resultHeader.delete('content-length');
  resultHeader.delete('transfer-encoding');

  resultHeader.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(gqlResponse), {
    headers: resultHeader,
  });
}

export async function proxy(parsedRequest: ParsedRequest | ParsedError, config: ProxyConfig): Promise<Response> {
  if (isParsedError(parsedRequest)) {
    return createErrorResponse(parsedRequest[errorMessageSymbol], parsedRequest[errorCodeSymbol]);
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

  const originResponse = await (config.originFetch?.(config.originURL, originRequest) ??
    defaultOriginRequest(config.originURL, originRequest));

  return originResponse;
}

export type ParseRequestFn<TParsed extends ParsedRequest> = (request: Request) => Promise<TParsed | ParsedError>;

export type ProxyFn = (parsed: ParsedRequest) => Promise<Response>;
export type FormatOriginRespFn = (result: OriginGraphQLResponse, originResponse: Response) => Promise<Response>;

export type OriginGraphQLResponse = {
  data?: any;
  extensions?: Array<any>;
  errors?: Array<any>;
};

export const createHandler = <TParsedRequest extends ParsedRequest>(
  originURL: string,
  parseRequest: ParseRequestFn<TParsedRequest>,
  opts?: Partial<CreateProxyOpts>
) => {
  const _proxy = createGraphQLProxy(originURL, parseRequest, opts);

  return async function handle(request: Request, collector?: ReportCollector) {
    const parsed = await _proxy.parseRequest(request);

    collector?.onRequestParsed(parsed);
    if (isParsedError(parsed)) {
      return createParseErrorResponse(parsed);
    }

    const proxyResponse = await _proxy.proxy(parsed);
    collector?.onProxied(proxyResponse);
    if (!proxyResponse.ok) {
      return proxyResponse;
    }

    const parsedResult = await _proxy.parseResponse(proxyResponse);

    if (!parsedResult) {
      return createErrorResponse('cannot parse response', 406);
    }

    collector?.onResponseParsed(parsedResult);

    const result = await _proxy.formatResponse(parsedResult, proxyResponse);

    return result;
  };
};

export type CreateProxyOpts = {
  proxy: ProxyFn;
  formatOriginResp: FormatOriginRespFn;
};

export const createGraphQLProxy = <TParsedRequest extends ParsedRequest>(
  originURL: string,
  parseRequest: ParseRequestFn<TParsedRequest>,
  opts?: Partial<CreateProxyOpts>
) => {
  const proxyConfig = { originURL: originURL };
  const finalOpts = Object.assign<CreateProxyOpts, Partial<CreateProxyOpts>>(
    {
      formatOriginResp: (parsedResponse, response) =>
        parseOriginResponse(parsedResponse, response, { errorMasking: '[Suggestion hidden]', removeExtensions: false }),
      proxy: (parsed) => proxy(parsed, proxyConfig),
    },
    opts ?? {}
  );

  async function _proxy(parsed: ParsedRequest<Record<string, any>>) {
    let proxyResponse: Response;
    try {
      proxyResponse = await finalOpts.proxy(parsed);
    } catch (e: any) {
      return createErrorResponse(e.message ?? 'internal error', 500);
    }

    return proxyResponse;
  }

  async function _parseProxy(proxyResponse: Response): Promise<OriginGraphQLResponse | null> {
    if (!proxyResponse.ok) {
      return null;
    }

    const contentType = proxyResponse.headers.get('content-type') ?? '';
    if (!(contentType.includes('application/json') || contentType.includes('application/graphql-response+json'))) {
      return null;
    }

    let payload: OriginGraphQLResponse;

    try {
      payload = await proxyResponse.json();
    } catch (e) {
      return null;
    }

    return payload;
  }

  return {
    parseRequest: parseRequest,
    proxy: _proxy,
    parseResponse: _parseProxy,
    formatResponse: finalOpts.formatOriginResp,
  };
};
