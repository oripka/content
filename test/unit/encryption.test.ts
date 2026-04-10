import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  b64ToBytes,
  bytesToB64,
  decryptEnvelopeToGzipBytes,
  deriveContentKeyB64,
  deriveContentKeyRaw,
  encryptGzBase64Envelope,
  isEncryptedEnvelope,
  normalizeBase64,
  parseEnvelopeMaybeBase64,
  toArrayBuffer,
} from '../../src/runtime/internal/encryption'

const masterKeyB64 = Buffer.from('12345678901234567890123456789012').toString('base64')
const gzPayload = gzipSync(Buffer.from(JSON.stringify(['select 1;', 'select 2;']), 'utf8'))
const gzPayloadB64 = gzPayload.toString('base64')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime encryption helpers', () => {
  it('normalizes base64 and decodes through the browser path', () => {
    expect(normalizeBase64(' YW\nJj\tZA== \r')).toBe('YWJjZA==')
    expect(Array.from(b64ToBytes(' YW\nJjZA== '))).toEqual(Array.from(Buffer.from('abcd')))
  })

  it('decodes base64 through the node buffer path when atob is unavailable', () => {
    vi.stubGlobal('atob', undefined)

    expect(Array.from(b64ToBytes('YWJjZA=='))).toEqual(Array.from(Buffer.from('abcd')))
  })

  it('encodes base64 through both buffer and btoa paths', () => {
    const bytes = new Uint8Array([97, 98, 99, 100])

    expect(bytesToB64(bytes)).toBe('YWJjZA==')

    vi.stubGlobal('Buffer', undefined)
    expect(bytesToB64(bytes)).toBe('YWJjZA==')
  })

  it('throws when no base64 encoder is available', () => {
    vi.stubGlobal('Buffer', undefined)
    vi.stubGlobal('btoa', undefined)

    expect(() => bytesToB64(new Uint8Array([1, 2, 3]))).toThrow('[content] No base64 encoder available in this runtime')
  })

  it('returns full and sliced array buffers correctly', () => {
    const full = new Uint8Array([1, 2, 3])
    expect(toArrayBuffer(full)).toBe(full.buffer)

    const sliced = new Uint8Array(new Uint8Array([0, 1, 2, 3]).buffer, 1, 2)
    const slicedBuffer = toArrayBuffer(sliced)
    expect(Array.from(new Uint8Array(slicedBuffer))).toEqual([1, 2])
    expect(slicedBuffer.byteLength).toBe(2)
  })

  it('copies shared array buffers into plain array buffers', () => {
    const shared = new SharedArrayBuffer(4)
    const view = new Uint8Array(shared)
    view.set([4, 5, 6, 7])

    const copied = toArrayBuffer(view)

    expect(copied).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(copied))).toEqual([4, 5, 6, 7])
  })

  it('derives deterministic keys and varies them by checksum and collection', async () => {
    const rawA = await deriveContentKeyRaw(masterKeyB64, 'checksum-a', 'posts')
    const rawA2 = await deriveContentKeyRaw(masterKeyB64, 'checksum-a', 'posts')
    const rawB = await deriveContentKeyRaw(masterKeyB64, 'checksum-b', 'posts')
    const rawC = await deriveContentKeyRaw(masterKeyB64, 'checksum-a', 'pages')
    const rawEmpty = await deriveContentKeyRaw(masterKeyB64, '', 'posts')

    expect(rawA).toHaveLength(32)
    expect(Array.from(rawA2)).toEqual(Array.from(rawA))
    expect(Array.from(rawB)).not.toEqual(Array.from(rawA))
    expect(Array.from(rawC)).not.toEqual(Array.from(rawA))
    expect(Array.from(rawEmpty)).not.toEqual(Array.from(rawA))

    const b64 = await deriveContentKeyB64(masterKeyB64, 'checksum-a', 'posts')
    expect(Array.from(b64ToBytes(b64))).toEqual(Array.from(rawA))
  })

  it('parses envelopes from base64 json, raw json, and rejects invalid input', async () => {
    const envB64 = await encryptGzBase64Envelope(gzPayloadB64, masterKeyB64, 'checksum-a', 'posts')
    const rawJson = Buffer.from(envB64, 'base64').toString('utf8')

    expect(parseEnvelopeMaybeBase64(envB64)).toMatchObject({ v: 1, alg: 'A256GCM' })
    expect(parseEnvelopeMaybeBase64(rawJson)).toMatchObject({ v: 1, alg: 'A256GCM' })
    expect(parseEnvelopeMaybeBase64(Buffer.from(JSON.stringify({ v: 2, alg: 'A256GCM' }), 'utf8').toString('base64'))).toBeNull()
    expect(parseEnvelopeMaybeBase64(JSON.stringify({ v: 2, alg: 'A256GCM' }))).toBeNull()
    expect(parseEnvelopeMaybeBase64('not-json')).toBeNull()

    expect(isEncryptedEnvelope(envB64)).toBe(true)
    expect(isEncryptedEnvelope(rawJson)).toBe(true)
    expect(isEncryptedEnvelope('plain-text')).toBe(false)
  })

  it('encrypts and decrypts gzip envelopes', async () => {
    const checksum = 'checksum-a'
    const collection = 'posts'
    const envB64 = await encryptGzBase64Envelope(gzPayloadB64, masterKeyB64, checksum, collection)
    const derivedKey = await deriveContentKeyB64(masterKeyB64, checksum, collection)

    const decrypted = await decryptEnvelopeToGzipBytes(envB64, derivedKey)

    expect(Array.from(decrypted)).toEqual(Array.from(gzPayload))
  })

  it('encodes encrypted envelopes with Buffer when btoa is unavailable', async () => {
    vi.stubGlobal('btoa', undefined)

    const envB64 = await encryptGzBase64Envelope(gzPayloadB64, masterKeyB64, 'checksum-a', 'posts')

    expect(typeof envB64).toBe('string')
    expect(parseEnvelopeMaybeBase64(envB64)).toMatchObject({ v: 1, alg: 'A256GCM' })
  })

  it('rejects invalid encrypted dump envelopes', async () => {
    await expect(decryptEnvelopeToGzipBytes('not-an-envelope', masterKeyB64))
      .rejects.toThrow('Invalid encrypted dump envelope')
  })
})
