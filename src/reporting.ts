import { Hooks, OriginGraphQLResponse, ParsedError, ParsedRequest, errorMessageSymbol, isParsedError } from '.';

export type Report = {
  /**
   * GraphQL errors coming from the origin
   */
  errors?: Array<any>;
  ok: boolean;
  originStatus?: number;
  operationName?: string;
  query?: string;
  /**
   * Size of input variables
   */
  inputSize: number;
  response_size: number;
  response_map?: Record<string, number>;
  // responseFields?: Map<string, number>;
  durations: {
    /**
     * Duration of parsing incoming request
     */
    parsing: number;
    /**
     * Duration of getting request from the origin
     */
    proxying: number;
    /**
     * Duration of processing the proxy response
     */
    processing: number;
    /**
     * Total time spend in function
     */
    total: number;
  };
};

export const kReportParsed = Symbol('parsed');
export const kReportProxy = Symbol('proxy');
export const kReportResponse = Symbol('processed');

function createEmptyReportContext(): ReportContext {
  return {
    [kReportParsed]: null,
    [kReportProxy]: null,
    [kReportResponse]: null,
  };
}

export type ReportContext = {
  [kReportParsed]: null | {
    ts: number;
    parsed: ParsedRequest | ParsedError;
  };
  [kReportProxy]: null | {
    ts: number;
    response: Response;
  };
  [kReportResponse]: null | {
    ts: number;
    resp: OriginGraphQLResponse;
  };
};

export function createReportHooks<TContext extends ReportContext>(): Hooks<TContext> {
  return {
    onRequestParsed(parsed, ctx) {
      ctx[kReportParsed] = {
        parsed: parsed,
        ts: Date.now(),
      };
      //
    },
    onProxied(resp, ctx) {
      ctx[kReportProxy] = {
        ts: Date.now(),
        response: resp.clone(),
      };
    },
    onResponseParsed(gqlResponse, ctx) {
      ctx[kReportResponse] = {
        resp: gqlResponse,
        ts: Date.now(),
      };
    },
  };
}

function calculateResponse(item: any, path: string, map: Map<string, number>) {
  // we only don't count undefines
  if (item === undefined) {
    return;
  }
  // is array
  if (item && Array.isArray(item)) {
    let i = 0;
    const arrLength = item.length;
    map.set(path, (map.get(path) ?? 0) + arrLength);
    for (; i < arrLength; ++i) {
      calculateResponse(item[i], path, map);
    }

    return;
  }

  // is object
  if (item && typeof item === 'object') {
    const keys = Object.keys(item);
    let i = 0;
    const keyLength = keys.length;
    for (; i < keyLength; ++i) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const key = keys[i]!;
      calculateResponse(item[key], path + '.' + key, map);
    }

    return;
  }

  const count = (map.get(path) ?? 0) + 1;
  map.set(path, count);
}

function calculateResponseMap(data: any): Record<string, number> {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const map = new Map<string, number>();

  calculateResponse(data, '$', map);

  return Object.fromEntries(map.entries());
}

function calculateSize(json?: Record<string, any>) {
  if (!json) {
    return 0;
  }

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(json)).byteLength;
}

export type ReportOptions = {
  calculateResponse: boolean;
};

export const createReport = (opts?: Partial<ReportOptions>) => {
  const options = Object.assign<ReportOptions, Partial<ReportOptions> | undefined>(
    {
      calculateResponse: true,
    },
    opts
  );
  const started_at = Date.now();
  const context = createEmptyReportContext();

  async function collect(response: Response): Promise<Report> {
    const collect_at = Date.now();
    const total = collect_at - started_at;
    const clonedResponse = response.clone();

    const parsedRequest = context[kReportParsed];
    const proxyResponse = context[kReportProxy];
    const gqlResponse = context[kReportResponse];

    const responseSize = +(
      clonedResponse.headers.get('content-size') ?? (await clonedResponse.arrayBuffer()).byteLength
    );

    if (!parsedRequest) {
      return {
        ok: false,
        response_size: responseSize,
        durations: {
          parsing: 0,
          processing: 0,
          proxying: 0,
          total: total,
        },
        // could not parse
        inputSize: 0,
        errors: [{ message: 'cannot parse' }],
      };
    }

    const parsingDuration = parsedRequest.ts - started_at;

    if (isParsedError(parsedRequest.parsed)) {
      return {
        ok: false,
        response_size: responseSize,
        // responseFields: new Map(),
        durations: {
          parsing: parsingDuration,
          processing: 0,
          proxying: 0,
          total: total,
        },
        // could not parse
        inputSize: 0,
        errors: [{ message: 'cannot parse: ' + parsedRequest.parsed[errorMessageSymbol] }],
      };
    }

    return {
      ok:
        clonedResponse.status === 200 &&
        gqlResponse?.resp.data !== undefined &&
        (gqlResponse.resp.errors === undefined ||
          (Array.isArray(gqlResponse.resp.errors) && gqlResponse.resp.errors.length === 0)),
      response_size: responseSize,
      response_map: options.calculateResponse && gqlResponse ? calculateResponseMap(gqlResponse.resp.data) : undefined,
      inputSize: calculateSize(parsedRequest.parsed.variables),
      errors:
        gqlResponse && Array.isArray(gqlResponse.resp.errors) && gqlResponse.resp.errors.length > 0
          ? gqlResponse.resp.errors
          : undefined,
      operationName: parsedRequest.parsed.operationName,
      originStatus: proxyResponse?.response.status ?? undefined,
      query: parsedRequest.parsed.query,
      durations: {
        parsing: parsingDuration,
        proxying: proxyResponse ? proxyResponse.ts - parsedRequest.ts : 0,
        total: total,
        processing: proxyResponse ? collect_at - proxyResponse.ts : 0,
      },
    };
  }

  return {
    context,
    collect,
  };
};
