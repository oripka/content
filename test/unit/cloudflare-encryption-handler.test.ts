import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptEnvelopeToGzipBytes, deriveContentKeyB64 } from '../../src/runtime/internal/encryption'

const runtimeConfig = {
  content: {
    encryption: {
      enabled: true,
      masterKey: Buffer.from('12345678901234567890123456789012').toString('base64'),
    },
  },
}

const storageState = new Map<string, string | null>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig,
  useStorage: () => ({
    getItem: async <T>(key: string) => storageState.has(key) ? storageState.get(key) as T : null,
  }),
}))

const gzipBase64 = (lines: string[]) => gzipSync(Buffer.from(JSON.stringify(lines), 'utf8')).toString('base64')

function createEvent(url: string, collection: string) {
  const headers = new Map<string, string>()
  const setHeader = (name: string, value: string) => headers.set(name.toLowerCase(), value)
  return {
    path: url,
    node: {
      req: { url },
      res: { setHeader, getHeader: (name: string) => headers.get(name.toLowerCase()) },
    },
    context: {
      params: { collection },
      cloudflare: {
        request: { url: `https://example.com${url}` },
        env: {},
      },
    },
    __headers: headers,
  } as any
}

function createAssetBinding(responses: Array<{ ok: boolean, body: string, contentType?: string }>) {
  const queue = [...responses]
  return {
    fetch: vi.fn(async () => {
      const next = queue.shift() ?? { ok: false, body: '', contentType: 'text/plain' }
      return {
        ok: next.ok,
        headers: { get: () => next.contentType || 'text/plain' },
        text: async () => next.body,
      }
    }),
  }
}

afterEach(() => {
  storageState.clear()
  runtimeConfig.content.encryption.enabled = true
  vi.restoreAllMocks()
})

describe('cloudflare encryption database handler', () => {
  it('derives keys from the route collection even when the kid names another collection', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')
    const checksum = 'sum-1'
    const event = createEvent('/api/__nuxt_content/course_tcp/key?kid=v1:blog_public:sum-1', 'course_tcp')

    const response = await handler(event)
    const expected = await deriveContentKeyB64(runtimeConfig.content.encryption.masterKey, checksum, 'course_tcp')
    const wrong = await deriveContentKeyB64(runtimeConfig.content.encryption.masterKey, checksum, 'blog_public')

    expect(response).toEqual({
      kid: 'v1:blog_public:sum-1',
      k: expected,
    })
    expect(response.k).not.toBe(wrong)
  })

  it('keeps encrypted dumps isolated across multiple collections', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')
    const checksum = 'shared-checksum'

    storageState.set('build:content:raw:dump.course_tcp.sql', gzipBase64(['select 1;']))
    storageState.set('build:content:raw:dump.course_http.sql', gzipBase64(['select 1;']))

    const tcpEvent = createEvent('/__nuxt_content/course_tcp/sql_dump.enc?v=shared-checksum', 'course_tcp')
    const httpEvent = createEvent('/__nuxt_content/course_http/sql_dump.enc?v=shared-checksum', 'course_http')

    const tcpEnvelope = await handler(tcpEvent)
    const httpEnvelope = await handler(httpEvent)
    const tcpKey = await deriveContentKeyB64(runtimeConfig.content.encryption.masterKey, checksum, 'course_tcp')
    const httpKey = await deriveContentKeyB64(runtimeConfig.content.encryption.masterKey, checksum, 'course_http')

    const tcpBytes = await decryptEnvelopeToGzipBytes(tcpEnvelope, tcpKey)
    const httpBytes = await decryptEnvelopeToGzipBytes(httpEnvelope, httpKey)

    expect(Buffer.from(tcpBytes).toString('base64')).toBe(gzipBase64(['select 1;']))
    expect(Buffer.from(httpBytes).toString('base64')).toBe(gzipBase64(['select 1;']))
    await expect(decryptEnvelopeToGzipBytes(tcpEnvelope, httpKey)).rejects.toThrow()
    await expect(decryptEnvelopeToGzipBytes(httpEnvelope, tcpKey)).rejects.toThrow()
  })

  it('returns 404 for plaintext dump routes when encryption is enabled', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')
    storageState.set('build:content:raw:dump.course_tcp.sql', gzipBase64(['select 1;']))

    await expect(handler(createEvent('/__nuxt_content/course_tcp/sql_dump.txt', 'course_tcp')))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('serves plaintext dumps when encryption is disabled', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')
    runtimeConfig.content.encryption.enabled = false
    storageState.set('build:content:raw:dump.course_tcp.sql', 'plain-dump-body')

    await expect(handler(createEvent('/__nuxt_content/course_tcp/sql_dump.txt', 'course_tcp')))
      .resolves.toBe('plain-dump-body')
  })

  it('falls back to cloudflare assets for encrypted and plaintext dump routes', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')
    const checksum = 'asset-checksum'
    const encryptedAsset = createAssetBinding([
      { ok: true, body: '<!doctype html>', contentType: 'text/html' },
      { ok: false, body: '', contentType: 'text/plain' },
      { ok: false, body: '', contentType: 'text/plain' },
      { ok: true, body: gzipBase64(['asset line']), contentType: 'text/plain' }
    ])

    const encEvent = createEvent('/__nuxt_content/course_asset/sql_dump.enc?v=asset-checksum', 'course_asset')
    encEvent.context.cloudflare.env.ASSETS = encryptedAsset

    const encEnvelope = await handler(encEvent)
    const encKey = await deriveContentKeyB64(runtimeConfig.content.encryption.masterKey, checksum, 'course_asset')
    const encBytes = await decryptEnvelopeToGzipBytes(encEnvelope, encKey)
    expect(Buffer.from(encBytes).toString('base64')).toBe(gzipBase64(['asset line']))

    runtimeConfig.content.encryption.enabled = false
    const plainAsset = createAssetBinding([
      { ok: true, body: 'asset-plain-body', contentType: 'text/plain' }
    ])
    const plainEvent = createEvent('/__nuxt_content/course_asset/sql_dump.txt', 'course_asset')
    plainEvent.context.cloudflare.request.url = undefined
    plainEvent.context.cloudflare.env.ASSETS = plainAsset

    await expect(handler(plainEvent)).resolves.toBe('asset-plain-body')
  })

  it('returns 404 when encrypted dumps are requested without any dump source', async () => {
    const { default: handler } = await import('../../src/runtime/presets/cloudflare/database-handler')

    await expect(handler(createEvent('/__nuxt_content/course_missing/sql_dump.enc?v=missing', 'course_missing')))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
