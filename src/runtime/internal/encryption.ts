// src/runtime/internal/encryption.ts

// Use Web Crypto across environments (CF Workers, browsers, modern Node).
// In Node 18+, globalThis.crypto is available by default.
const cryptoAny: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto
if (!cryptoAny?.subtle) {
  throw new Error('[content] Web Crypto not available: globalThis.crypto.subtle is required')
}
const subtle: SubtleCrypto = cryptoAny.subtle
const te = new TextEncoder()

export function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  }
  // Node fallback
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function bytesToB64(arr: Uint8Array): string {
  if (typeof btoa === 'function') {
    return btoa(String.fromCharCode(...arr))
  }
  // Node fallback
  return Buffer.from(arr).toString('base64')
}

/** HKDF(master, salt=checksum, info=`content:${collection}`) → raw 32 bytes (AES-256) */
export async function deriveContentKeyRaw(
  masterKeyB64: string,
  checksum: string,
  collection: string,
): Promise<Uint8Array> {
  const master = b64ToBytes(masterKeyB64)
  const hkdfKey = await subtle.importKey('raw', master, 'HKDF', false, ['deriveKey'])
  const derived = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode(checksum || ''), info: te.encode(`content:${collection}`) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const raw = new Uint8Array(await subtle.exportKey('raw', derived))
  return raw
}

export async function deriveContentKeyB64(
  masterKeyB64: string,
  checksum: string,
  collection: string,
): Promise<string> {
  const raw = await deriveContentKeyRaw(masterKeyB64, checksum, collection)
  return bytesToB64(raw)
}

/** Encrypt base64(gzip(JSON)) → base64(JSON envelope) */
export async function encryptGzBase64Envelope(
  gzBase64: string,
  masterKeyB64: string,
  checksum: string,
  collection: string,
): Promise<string> {
  const keyRaw = await deriveContentKeyRaw(masterKeyB64, checksum, collection)
  const key = await subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt'])

  // IV generation via Web Crypto; required in all supported runtimes
  const iv = cryptoAny.getRandomValues(new Uint8Array(12))

  const gzBytes = b64ToBytes(gzBase64)
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, gzBytes))

  const envelope = {
    v: 1,
    alg: 'A256GCM',
    kid: `v1:${collection}:${checksum}`,
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ct),
  }
  const json = JSON.stringify(envelope)
  // return base64(JSON)
  if (typeof btoa === 'function') return btoa(json)
  return Buffer.from(json, 'utf8').toString('base64')
}

// Types
export interface DumpEnvelope {
  v: 1
  alg: 'A256GCM'
  kid: string
  iv: string // base64(12)
  ciphertext: string // base64
}

// Parse base64(JSON) or raw JSON string → envelope (or null)
export function parseEnvelopeMaybeBase64(input: string): DumpEnvelope | null {
  try {
    // base64(JSON)
    const json = typeof atob === 'function'
      ? new TextDecoder().decode(Uint8Array.from(atob(input), c => c.charCodeAt(0)))
      : Buffer.from(input, 'base64').toString('utf8')
    const e = JSON.parse(json)
    return (e?.v === 1 && e?.alg === 'A256GCM') ? e as DumpEnvelope : null
  }
  catch {
    try {
      const e = JSON.parse(input)
      return (e?.v === 1 && e?.alg === 'A256GCM') ? e as DumpEnvelope : null
    }
    catch {
      return null
    }
  }
}

export function isEncryptedEnvelope(input: string): boolean {
  return !!parseEnvelopeMaybeBase64(input)
}

/**
 * Decrypt an envelope (given raw 32-byte key as base64) → gzipped bytes (Uint8Array)
 * Useful for both server and client paths.
 */
export async function decryptEnvelopeToGzipBytes(
  envelopeInput: string,
  keyRawB64: string,
): Promise<Uint8Array> {
  const env = parseEnvelopeMaybeBase64(envelopeInput)
  if (!env) throw new Error('Invalid encrypted dump envelope')
  const keyBytes = b64ToBytes(keyRawB64)
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = b64ToBytes(env.iv)
  const ciphertext = b64ToBytes(env.ciphertext)
  const gz = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
  return gz
}
