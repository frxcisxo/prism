export interface ModelManifestSignature {
  algorithm: 'HMAC-SHA256';
  keyId?: string;
  signedAt: string;
  value: string;
}

export type SignedModelManifest<T extends Record<string, any>> = T & {
  signature: ModelManifestSignature;
};

export interface ModelManifestSigningOptions {
  keyId?: string;
  signedAt?: string | Date;
}

export interface ModelManifestVerificationResult {
  valid: boolean;
  reason?: string;
  keyId?: string;
  signedAt?: string;
}

const signaturePrefix = 'hmac-sha256:';

export async function signModelManifest<T extends Record<string, any>>(
  manifest: T,
  secret: string | Uint8Array,
  options: ModelManifestSigningOptions = {}
): Promise<SignedModelManifest<T>> {
  const signedAt = normalizeSignedAt(options.signedAt);
  const signatureBase = {
    algorithm: 'HMAC-SHA256' as const,
    ...(options.keyId ? { keyId: options.keyId } : {}),
    signedAt,
  };
  const value = `${signaturePrefix}${await hmacSha256Hex(secret, signaturePayload(manifest, signatureBase))}`;

  return {
    ...stripSignature(manifest),
    signature: {
      ...signatureBase,
      value,
    },
  } as SignedModelManifest<T>;
}

export async function verifySignedModelManifest<T extends Record<string, any>>(
  signedManifest: SignedModelManifest<T>,
  secret: string | Uint8Array,
  expectedKeyId?: string
): Promise<ModelManifestVerificationResult> {
  const signature = signedManifest.signature;
  if (!signature || signature.algorithm !== 'HMAC-SHA256') {
    return { valid: false, reason: 'unsupported-signature-algorithm' };
  }
  if (!signature.value?.startsWith(signaturePrefix)) {
    return { valid: false, reason: 'invalid-signature-format' };
  }
  if (expectedKeyId && signature.keyId !== expectedKeyId) {
    return {
      valid: false,
      reason: 'key-id-mismatch',
      keyId: signature.keyId,
      signedAt: signature.signedAt,
    };
  }

  const expected = `${signaturePrefix}${await hmacSha256Hex(secret, signaturePayload(signedManifest, {
    algorithm: signature.algorithm,
    ...(signature.keyId ? { keyId: signature.keyId } : {}),
    signedAt: signature.signedAt,
  }))}`;
  const valid = await timingSafeEqual(signature.value, expected);

  return {
    valid,
    ...(valid ? {} : { reason: 'signature-mismatch' }),
    keyId: signature.keyId,
    signedAt: signature.signedAt,
  };
}

export async function assertSignedModelManifest<T extends Record<string, any>>(
  signedManifest: SignedModelManifest<T>,
  secret: string | Uint8Array,
  expectedKeyId?: string
): Promise<void> {
  const result = await verifySignedModelManifest(signedManifest, secret, expectedKeyId);
  if (!result.valid) {
    throw new Error(`Model manifest signature verification failed: ${result.reason || 'unknown'}`);
  }
}

export function canonicalizeManifest(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

function signaturePayload(manifest: Record<string, any>, signature: Omit<ModelManifestSignature, 'value'>): string {
  return canonicalizeManifest({
    manifest: stripSignature(manifest),
    signature,
  });
}

function stripSignature<T extends Record<string, any>>(manifest: T): Omit<T, 'signature'> {
  const { signature: _signature, ...unsigned } = manifest;
  return unsigned;
}

function normalizeSignedAt(value?: string | Date): string {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : value;
}

function toCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCanonicalValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const object = value as Record<string, unknown>;
  return Object.keys(object)
    .sort()
    .reduce<Record<string, unknown>>((canonical, key) => {
      if (object[key] !== undefined) {
        canonical[key] = toCanonicalValue(object[key]);
      }
      return canonical;
    }, {});
}

async function hmacSha256Hex(secret: string | Uint8Array, payload: string): Promise<string> {
  const keyBytes = toBytes(secret);
  const payloadBytes = new TextEncoder().encode(payload);
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    const key = await subtle.importKey(
      'raw',
      toArrayBuffer(keyBytes),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await subtle.sign('HMAC', key, toArrayBuffer(payloadBytes));
    return bytesToHex(new Uint8Array(signature));
  }

  const crypto = await (new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>)('node:crypto');
  return crypto.createHmac('sha256', keyBytes).update(payloadBytes).digest('hex');
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  try {
    const crypto = await (new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>)('node:crypto');
    return crypto.timingSafeEqual(leftBytes, rightBytes);
  } catch {
    let diff = 0;
    for (let index = 0; index < leftBytes.length; index += 1) {
      diff |= leftBytes[index] ^ rightBytes[index];
    }
    return diff === 0;
  }
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  return stable.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
