import { deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decompressSQLDump, decryptAndDecompressSQLDump } from '../../src/runtime/internal/dump'
import { deriveContentKeyB64, encryptGzBase64Envelope } from '../../src/runtime/internal/encryption'

const masterKeyB64 = Buffer.from('12345678901234567890123456789012').toString('base64')
const sampleJson = JSON.stringify(['hello world'])
const gzipBase64 = gzipSync(sampleJson).toString('base64')
const deflateBase64 = deflateSync(sampleJson).toString('base64')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decompressSQLDump', () => {
  it('decompresses gzip content through a successful browser-style stream path', async () => {
    class FakeBlob {
      constructor(public parts: unknown[]) {}
    }
    class FakeDecompressionStream {
      constructor(_format: CompressionFormat) {}
    }
    class FakeResponse {
      body?: { pipeThrough: (_stream: unknown) => { text: () => Promise<string> } }
      private readonly value: unknown

      constructor(value: unknown) {
        this.value = value
        if (value instanceof FakeBlob) {
          this.body = {
            pipeThrough: () => ({
              text: async () => sampleJson,
            }),
          }
        }
      }

      async text() {
        return this.value && typeof this.value === 'object' && 'text' in this.value
          ? await (this.value as { text: () => Promise<string> }).text()
          : String(this.value ?? '')
      }
    }

    vi.stubGlobal('Blob', FakeBlob)
    vi.stubGlobal('Response', FakeResponse)
    vi.stubGlobal('DecompressionStream', FakeDecompressionStream)

    const result = await decompressSQLDump(gzipBase64)
    expect(result).toEqual(['hello world'])
  })

  it('decompresses deflate content through the node fallback path', async () => {
    vi.stubGlobal('atob', undefined)

    const result = await decompressSQLDump(deflateBase64, 'deflate')

    expect(result).toEqual(['hello world'])
  })

  it('decompresses gzip content through the node fallback path', async () => {
    vi.stubGlobal('atob', undefined)

    const result = await decompressSQLDump(gzipBase64)

    expect(result).toEqual(['hello world'])
  })

  it('should handle empty input', async () => {
    const emptyString = ''

    await expect(decompressSQLDump(emptyString))
      .rejects.toThrow()
  })

  it('should throw error on invalid base64 input', async () => {
    const invalidBase64 = 'invalid-base64!'

    await expect(decompressSQLDump(invalidBase64))
      .rejects.toThrow()
  })

  it('should throw error on invalid compression format', async () => {
    // @ts-expect-error Testing invalid compression type
    await expect(decompressSQLDump(gzipBase64, 'invalid-format'))
      .rejects.toThrow()
  })

  it('throws when neither browser nor node decoding paths are available', async () => {
    vi.stubGlobal('atob', undefined)
    vi.stubGlobal('Buffer', undefined)

    await expect(decompressSQLDump(gzipBase64))
      .rejects.toThrow('No base64 decoding method available')
  })

  it('throws when browser decompression fails and node fallback is unavailable', async () => {
    class ThrowingBlob {
      constructor(public parts: unknown[]) {}
    }
    class ThrowingDecompressionStream {
      constructor(_format: CompressionFormat) {}
    }
    class ThrowingResponse {
      body?: { pipeThrough: (_stream: unknown) => never }

      constructor(value: unknown) {
        if (value instanceof ThrowingBlob) {
          this.body = {
            pipeThrough: () => {
              throw new Error('stream failed')
            },
          }
        }
      }

      async text() {
        return sampleJson
      }
    }

    vi.stubGlobal('Blob', ThrowingBlob)
    vi.stubGlobal('Response', ThrowingResponse)
    vi.stubGlobal('DecompressionStream', ThrowingDecompressionStream)
    vi.stubGlobal('Buffer', undefined)

    await expect(decompressSQLDump(gzipBase64))
      .rejects.toThrow('No base64 decoding method available')
  })
})

describe('decryptAndDecompressSQLDump', () => {
  it('decrypts a base64-encoded envelope', async () => {
    const checksum = 'checksum-a'
    const collection = 'posts'
    const encrypted = await encryptGzBase64Envelope(gzipBase64, masterKeyB64, checksum, collection)
    const key = await deriveContentKeyB64(masterKeyB64, checksum, collection)

    await expect(decryptAndDecompressSQLDump(encrypted, key))
      .resolves.toEqual(['hello world'])
  })

  it('decrypts a raw json envelope string', async () => {
    const checksum = 'checksum-a'
    const collection = 'posts'
    const encrypted = await encryptGzBase64Envelope(gzipBase64, masterKeyB64, checksum, collection)
    const rawEnvelope = Buffer.from(encrypted, 'base64').toString('utf8')
    const key = await deriveContentKeyB64(masterKeyB64, checksum, collection)

    await expect(decryptAndDecompressSQLDump(rawEnvelope, key))
      .resolves.toEqual(['hello world'])
  })

  it('decrypts through the node fallback when decompression streams are unavailable', async () => {
    const checksum = 'checksum-a'
    const collection = 'posts'
    const encrypted = await encryptGzBase64Envelope(gzipBase64, masterKeyB64, checksum, collection)
    const key = await deriveContentKeyB64(masterKeyB64, checksum, collection)

    vi.stubGlobal('DecompressionStream', undefined)

    await expect(decryptAndDecompressSQLDump(encrypted, key))
      .resolves.toEqual(['hello world'])
  })

  it('rejects unsupported envelope shapes', async () => {
    const badEnvelope = Buffer.from(JSON.stringify({ v: 2, alg: 'A256GCM', iv: 'a', ciphertext: 'b' }), 'utf8').toString('base64')

    await expect(decryptAndDecompressSQLDump(badEnvelope, masterKeyB64))
      .rejects.toThrow('Unsupported dump envelope')
  })
})
