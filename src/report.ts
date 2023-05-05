import { crypto } from '@whatwg-node/fetch';

export interface OperationReport {
  t_id: string;
  op: string;
  args: string[];
  ts: number;
  exec: {
    ok: boolean;
    d: number;
    te: number;
    errs: {
      message: string;
      path?: string | undefined;
    }[];
  };
}

/**
 * Get all paths from a object
 */
function getArguments(variables: Record<string, unknown> | undefined): string[] {
  if (!variables) {
    return [];
  }
  const paths: Array<string[]> = [];
  const nodes = [
    {
      obj: variables,
      path: [] as string[],
    },
  ];
  while (nodes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const n = nodes.pop()!;
    Object.keys(n.obj).forEach((k) => {
      const path = n.path.concat(k);
      paths.push(path);
      if (typeof n.obj[k] === 'object') {
        nodes.unshift({
          obj: n.obj[k] as Record<string, unknown>,
          path: path,
        });
      }
    });
  }
  return paths.map((p) => p.join('.'));
}

export function createInitialReport(stableOperation: string, variables: Record<string, unknown> | undefined) {
  return {
    operation: stableOperation,
    startTime: Date.now(),
    variables,
  };
}

export type InitialReport = ReturnType<typeof createInitialReport>;

export function finishReport(
  report: ReturnType<typeof createInitialReport>,
  result: Record<string, unknown>
): OperationReport {
  const { operation, startTime, variables } = report;
  const errors =
    result.errors && Array.isArray(result.errors)
      ? result.errors.map((error: any) => ({
          message: error.message,
          path: error.path?.join('.'),
        }))
      : [];

  const now = Date.now();
  const duration = now - startTime;

  return {
    t_id: crypto.randomUUID(),
    op: operation,
    ts: now,
    args: getArguments(variables),
    exec: {
      d: duration,
      te: errors.length,
      ok: errors.length === 0 && !!result.data,
      errs: errors,
    },
  };
}
