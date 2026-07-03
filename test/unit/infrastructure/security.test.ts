import { describe, expect, it } from 'vitest';
import {
  assertSignedModelManifest,
  canonicalizeEncryptionData,
  canonicalizeManifest,
  decryptModelArtifact,
  encryptModelArtifact,
  signModelManifest,
  verifySignedModelManifest,
} from '../../../src/infrastructure/security';

describe('model manifest signing', () => {
  const manifest = {
    modelId: 'edge-planner-small',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    shards: [
      { index: 1, sha256: 'c'.repeat(64), size: 2 },
      { index: 0, sha256: 'b'.repeat(64), size: 3 },
    ],
  };

  it('should canonicalize object keys deterministically', () => {
    expect(canonicalizeManifest({ b: 2, a: { d: 4, c: 3 } }))
      .toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('should sign and verify a model manifest', async () => {
    const signed = await signModelManifest(manifest, 'test-secret', {
      keyId: 'edge-key-1',
      signedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(signed.signature).toMatchObject({
      algorithm: 'HMAC-SHA256',
      keyId: 'edge-key-1',
      signedAt: '2026-07-03T00:00:00.000Z',
    });
    expect(signed.signature.value).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    await expect(verifySignedModelManifest(signed, 'test-secret', 'edge-key-1'))
      .resolves.toMatchObject({ valid: true, keyId: 'edge-key-1' });
  });

  it('should produce stable signatures for semantically identical manifests', async () => {
    const first = await signModelManifest({ b: 2, a: 1 }, 'test-secret', {
      signedAt: '2026-07-03T00:00:00.000Z',
    });
    const second = await signModelManifest({ a: 1, b: 2 }, 'test-secret', {
      signedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(first.signature.value).toBe(second.signature.value);
  });

  it('should reject tampered manifests', async () => {
    const signed = await signModelManifest(manifest, 'test-secret', {
      signedAt: '2026-07-03T00:00:00.000Z',
    });
    const tampered = {
      ...signed,
      sha256: '0'.repeat(64),
    };

    await expect(verifySignedModelManifest(tampered, 'test-secret'))
      .resolves.toMatchObject({ valid: false, reason: 'signature-mismatch' });
    await expect(assertSignedModelManifest(tampered, 'test-secret'))
      .rejects.toThrow('signature-mismatch');
  });

  it('should reject unexpected key ids', async () => {
    const signed = await signModelManifest(manifest, 'test-secret', {
      keyId: 'edge-key-1',
      signedAt: '2026-07-03T00:00:00.000Z',
    });

    await expect(verifySignedModelManifest(signed, 'test-secret', 'edge-key-2'))
      .resolves.toMatchObject({ valid: false, reason: 'key-id-mismatch' });
  });
});

describe('model artifact encryption', () => {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const additionalData = {
    modelId: 'edge-planner-small',
    sha256: 'a'.repeat(64),
  };

  it('should canonicalize additional authenticated data deterministically', () => {
    expect(canonicalizeEncryptionData({ z: 1, a: { c: 3, b: 2 } }))
      .toBe('{"a":{"b":2,"c":3},"z":1}');
  });

  it('should encrypt and decrypt binary model artifacts', async () => {
    const artifact = new Uint8Array([80, 82, 73, 83, 77]);
    const encrypted = await encryptModelArtifact(artifact, 'artifact-secret', {
      salt,
      iv,
      iterations: 1_000,
      additionalData,
    });
    const decrypted = await decryptModelArtifact(encrypted, 'artifact-secret', {
      additionalData,
    });

    expect(encrypted).toMatchObject({
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 1_000,
      aad: '{"modelId":"edge-planner-small","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    });
    expect(encrypted.ciphertext).not.toContain('PRISM');
    expect(Array.from(decrypted)).toEqual([80, 82, 73, 83, 77]);
  });

  it('should produce stable envelopes when salt and iv are supplied', async () => {
    const first = await encryptModelArtifact('model-bytes', 'artifact-secret', {
      salt,
      iv,
      iterations: 1_000,
    });
    const second = await encryptModelArtifact('model-bytes', 'artifact-secret', {
      salt,
      iv,
      iterations: 1_000,
    });

    expect(first).toEqual(second);
  });

  it('should reject decryption with the wrong secret', async () => {
    const encrypted = await encryptModelArtifact('model-bytes', 'artifact-secret', {
      salt,
      iv,
      iterations: 1_000,
    });

    await expect(decryptModelArtifact(encrypted, 'wrong-secret'))
      .rejects.toThrow();
  });

  it('should reject decryption when additional data does not match', async () => {
    const encrypted = await encryptModelArtifact('model-bytes', 'artifact-secret', {
      salt,
      iv,
      iterations: 1_000,
      additionalData,
    });

    await expect(decryptModelArtifact(encrypted, 'artifact-secret', {
      additionalData: { modelId: 'other-model', sha256: 'a'.repeat(64) },
    })).rejects.toThrow('additional data mismatch');
  });
});
