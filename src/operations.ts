import { ParsedError, ParsedRequest, createError } from '.';

export type OperationType = 'query' | 'mutation' | 'subscription';

export type TypedOperation<R = any, V = any> = {
  operation: string;
  operationType: OperationType;
  __apiType?: (v: V) => R;
};

export type GeneratedOperation = {
  operationName: string;
  operationType: OperationType;
  query: string;
  behaviour: Partial<{
    ttl: number;
  }> &
    Record<string, any>;
};

export class ValidationError extends Error {}

export type ValidateFn<Vars = unknown> = (
  def: OpsDef,
  parsedRequest: ParsedRequest<Vars>,
  ctx: {
    originalRequest: Request;
  }
) => ValidationError | undefined | void;

export type OperationStore = ReturnType<typeof createOperationStore>;

export type OpsDef = Readonly<{
  operationName: string;
  operation: OperationType;
  query: string;
  behaviour: Partial<{
    ttl: number;
  }> &
    Record<string, any>;
}>;

/**
 * Create a operation store which can be used to create
 */
export function createOperationStore(operations: Array<GeneratedOperation>) {
  const validateMap = new Map<string, ValidateFn<any>>();

  const opsMap = new Map<string, OpsDef>(
    operations.map((oper) => [
      oper.operationName,
      {
        behaviour: oper.behaviour,
        operation: oper.operationType,
        operationName: oper.operationName,
        query: oper.query,
      },
    ])
  );

  function getOperation(operation: string) {
    const doc = opsMap.get(operation);

    return doc;
  }

  return {
    getOperation,
    getOperations() {
      return Array.from(opsMap.values());
    },
    getValidateFn(operationName: string) {
      return validateMap.get(operationName);
    },
    /**
     * Set a validate function for a specifc operation, is null is provided for the handler, removes it
     */
    setValidateFn<Vars>(operationName: string, handler: ValidateFn<Vars> | null) {
      if (handler === null) {
        validateMap.delete(operationName);
        return;
      }

      const ops = getOperation(operationName);

      if (!ops) {
        throw new Error(operationName + ' not registered');
      }

      validateMap.set(operationName, handler);
    },
  };
}

export function fromPostRequest(body: any): ExtractedResponse {
  const operation = body.op ?? body.operationName ?? body.operation ?? body.query;
  const variables = body.v ?? body.variables;
  return {
    operation,
    variables,
  };
}

export function fromGetRequest(query: Record<string, string>): ExtractedResponse {
  const operation = query['op'] ?? query['operation'] ?? query['query'];
  const variables = query['v'] ?? query['variables'];

  return {
    operation,
    variables: variables ? (typeof variables === 'string' ? JSON.parse(variables) : variables) : undefined,
  };
}

export type ExtractedResponse = {
  operation: string | undefined;
  variables: Record<string, any> | undefined;
};

export const defaultExtractFn = async (req: Request): Promise<ExtractedResponse> => {
  if (req.method === 'POST') {
    const body = await req.json();
    const payload = fromPostRequest(body);

    return {
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const params = url.searchParams;
    const payload = fromGetRequest(Object.fromEntries(params.entries()));

    return {
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  throw new Error('method not supported');
};

export type ExtractFn = (req: Request) => Promise<ExtractedResponse>;

export type ParsedResult = ParsedRequest & { def: OpsDef };

/**
 * Create parse function where every query is stored
 *
 */
export const createOperationParseFn = (operationStore: OperationStore, opts?: Partial<{ extractFn: ExtractFn }>) => {
  const finalOpts = Object.assign({ extractFn: defaultExtractFn }, opts);

  return async function parse(request: Request): Promise<ParsedResult | ParsedError> {
    let extracted: ExtractedResponse;
    try {
      extracted = await finalOpts.extractFn(request);
    } catch (e: any) {
      return createError(404, e.message ?? 'cannot extract request');
    }

    const operation = extracted.operation;

    if (!operation || typeof operation !== 'string') {
      return createError(404, 'no operation defined');
    }

    const def = operationStore.getOperation(operation);

    if (!def) {
      return createError(404, `operation ${operation} not found`);
    }

    const validateFn = operationStore.getValidateFn(def.operationName);

    const result: ParsedResult = {
      headers: request.headers,
      query: def.query,
      operationName: def.operationName,
      variables: extracted.variables,
      def: def,
    };

    if (validateFn) {
      const error = validateFn(def, result, { originalRequest: request });

      if (error) {
        return createError(400, error.message ?? 'input validation');
      }
    }

    return result;
  };
};
