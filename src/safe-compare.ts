import { crypto } from '@whatwg-node/fetch';

/**
 * Generate a random HMAC secret key
 * @param {object} [options]
 * @param {("SHA-1", "SHA-256", "SHA-384", "SHA-512")} [options.algorithm="SHA-256"] Hash algorithm
 * @returns {CryptoKey}
 */
export async function generateRandomSecretKey({ algorithm = 'SHA-1' } = {}) {
  return crypto.subtle.generateKey(
    {
      name: 'HMAC',
      hash: { name: algorithm },
    },
    true,
    ['sign']
  );
}

export function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacHex(secretKey: CryptoKey, message: Uint8Array) {
  // Sign the message with HMAC and the CryptoKey
  const signature = await crypto.subtle.sign('HMAC', secretKey, message);

  return bufferToHex(signature);
}

export async function webTimingSafeEqual(secretKey: CryptoKey, left: string, right: string) {
  const encoder = new TextEncoder();
  const leftUint8Array = encoder.encode(left);
  const rightUint8Array = encoder.encode(right);

  // Parallelize HMAC computations
  const [leftHMAC, rightHMAC] = await Promise.all([
    hmacHex(secretKey, leftUint8Array),
    hmacHex(secretKey, rightUint8Array),
  ]);

  return leftHMAC === rightHMAC;
}
