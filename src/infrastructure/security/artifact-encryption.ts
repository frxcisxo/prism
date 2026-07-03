export interface EncryptedModelArtifact {
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  aad?: string;
}

export interface ModelArtifactEncryptionOptions {
  iterations?: number;
  salt?: Uint8Array;
  iv?: Uint8Array;
  additionalData?: unknown;
}

const defaultIterations = 210_000;

export async function encryptModelArtifact(
  artifact: Uint8Array | ArrayBuffer | string,
  secret: string | Uint8Array,
  options: ModelArtifactEncryptionOptions = {}
): Promise<EncryptedModelArtifact> {
  const salt = options.salt || randomBytes(16);
  const iv = options.iv || randomBytes(12);
  const iterations = options.iterations || defaultIterations;
  const aad = options.additionalData === undefined
    ? undefined
    : canonicalizeEncryptionData(options.additionalData);
  const subtle = await getSubtleCrypto();
  const key = await deriveAesKey(subtle, secret, salt, iterations);
  const encrypted = await subtle.encrypt({
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    ...(aad ? { additionalData: toArrayBuffer(new TextEncoder().encode(aad)) } : {}),
  }, key, toArrayBuffer(toBytes(artifact)));

  return {
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
    ...(aad ? { aad } : {}),
  };
}

export async function decryptModelArtifact(
  encrypted: EncryptedModelArtifact,
  secret: string | Uint8Array,
  options: Pick<ModelArtifactEncryptionOptions, 'additionalData'> = {}
): Promise<Uint8Array> {
  if (encrypted.algorithm !== 'AES-256-GCM' || encrypted.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Unsupported model artifact encryption envelope');
  }

  const expectedAad = options.additionalData === undefined
    ? encrypted.aad
    : canonicalizeEncryptionData(options.additionalData);
  if (encrypted.aad !== expectedAad) {
    throw new Error('Encrypted model artifact additional data mismatch');
  }

  const subtle = await getSubtleCrypto();
  const salt = fromBase64Url(encrypted.salt);
  const iv = fromBase64Url(encrypted.iv);
  const key = await deriveAesKey(subtle, secret, salt, encrypted.iterations);
  const decrypted = await subtle.decrypt({
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    ...(encrypted.aad ? { additionalData: toArrayBuffer(new TextEncoder().encode(encrypted.aad)) } : {}),
  }, key, toArrayBuffer(fromBase64Url(encrypted.ciphertext)));

  return new Uint8Array(decrypted);
}

export function canonicalizeEncryptionData(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

async function deriveAesKey(
  subtle: SubtleCrypto,
  secret: string | Uint8Array,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey(
    'raw',
    toArrayBuffer(toBytes(secret)),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBuffer(salt),
    iterations,
  }, baseKey, {
    name: 'AES-GCM',
    length: 256,
  }, false, ['encrypt', 'decrypt']);
}

async function getSubtleCrypto(): Promise<SubtleCrypto> {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }

  const crypto = await (new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>)('node:crypto');
  if (crypto.webcrypto?.subtle) {
    return crypto.webcrypto.subtle;
  }

  throw new Error('WebCrypto SubtleCrypto is required for model artifact encryption');
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  throw new Error('crypto.getRandomValues is required for model artifact encryption');
}

function toBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  return stable.buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
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
