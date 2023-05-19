import { DocumentNode } from 'graphql';
import { ParseRequestFn, ParsedRequest, createError } from '.';
import { bufferToHex, generateRandomSecretKey, hmacHex, webTimingSafeEqual } from './safe-compare';
import { parse, printNormalized } from './utils';
import { crypto } from '@whatwg-node/fetch';

export const OPERATION_HEADER_KEY = 'x-proxy-op-hash';
export const PASSTHROUGH_HEADER_KEY = 'x-proxy-pass-secret';

export function getOperationHashFromHeader(req: Request) {
  return req.headers.get(OPERATION_HEADER_KEY);
}

export function getPassThroughSecretFromHeader(req: Request) {
  return req.headers.get(PASSTHROUGH_HEADER_KEY);
}

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

export type SignignAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

async function getHMACFromQuery(stableQuery: string, secret: string, algorithm: SignignAlgorithm) {
  const encoder = new TextEncoder();
  const secretKeyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey('raw', secretKeyData, { name: 'HMAC', hash: algorithm }, false, ['sign']);

  return hmacHex(key, encoder.encode(stableQuery));
}

export type ParsedResponse = ParsedRequest & {
  isPassthrough: boolean;
};

/**
 * Creates a parse function which validates a request against a signature header or a passthrough header
 */
export const createSignatureParseFn = <T = unknown>(config: {
  passThroughHash: string;
  signSecret:
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
  maxTokens: number;
}): ParseRequestFn<T> => {
  return async function parseRequest(request) {
    const isPassThrough = await isPassthroughRequest(request, config.passThroughHash);
    const hashHeader = getOperationHashFromHeader(request);
    const sign_secret = config.signSecret;

    if (!isPassThrough && sign_secret) {
      if (!hashHeader) {
        return createError(403, 'signature not defined');
      }
    }

    let body: { query: string; variables?: any; operationName?: string };
    try {
      body = await request.json();
    } catch (e) {
      return createError(403, 'not valid body');
    }

    if (!body.query) {
      return createError(403, 'Missing query in body');
    }

    let document: DocumentNode;
    try {
      document = parse(body.query, config.maxTokens ?? 2000);
    } catch (e) {
      return createError(403, 'cannot parse query');
    }
    const stableQuery = printNormalized(document);

    if (!isPassThrough && sign_secret) {
      const secret = typeof sign_secret === 'string' ? sign_secret : sign_secret.secret;
      const algo = typeof sign_secret === 'object' ? sign_secret.algorithm : 'SHA-256';

      const [randomSecretForTimingAttack, value] = await Promise.all([
        generateRandomSecretKey(),
        getHMACFromQuery(stableQuery, secret, algo),
      ]);
      const verified =
        hashHeader !== null && (await webTimingSafeEqual(randomSecretForTimingAttack, hashHeader, value));

      if (!verified) {
        return createError(403, `Invalid ${OPERATION_HEADER_KEY} header`);
      }
    }

    return {
      query: body.query,
      operationName: body.operationName,
      variables: body.variables,
      headers: request.headers,
      isPassthrough: isPassThrough,
    };
  };
};
