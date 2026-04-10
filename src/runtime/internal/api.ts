// src/runtime/internal/api.ts
import { useRuntimeConfig } from '#imports'
import { checksums } from '#content/manifest'
import { getRequestHeaders } from 'h3'
import { forceClientRefresh } from './client-reload'

import type { H3Event } from 'h3'

// Local types to avoid `any`
type PublicRuntime = { content?: { encryptionEnabled?: boolean } }
type PrivateRuntime = { content?: { encryption?: { enabled?: boolean } } }
type ErrorLike = { status?: number, statusCode?: number, response?: { status?: number }, message?: string }

function encOn() {
  const runtime = useRuntimeConfig()
  const pub = runtime.public as Partial<PublicRuntime>
  const priv = runtime as Partial<PrivateRuntime>
  return Boolean(pub?.content?.encryptionEnabled ?? priv?.content?.encryption?.enabled)
}

function isRecoverable(e: unknown) {
  const err = e as ErrorLike
  const s = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0)
  const m = String(err?.message ?? '')
  return [401, 403, 404].includes(s)
    || /decrypt|aes|gcm|checksum|ciphertext|operationerror/i.test(m)
}

async function selfHealOnce(event: H3Event | undefined, collection: string) {
  // Minimal self-heal: only clear this collection’s cached dump + checksum
  if (import.meta.client) {
    try {
      localStorage.removeItem(`content_${'checksum_' + collection}`)
      localStorage.removeItem(`content_${'collection_' + collection}`)
    }
    catch {
      // Non-critical: best-effort cleanup
    }
  }

  // If encryption is enabled, proactively (best-effort) re-fetch the key
  if (encOn()) {
    try {
      await fetchDumpKey(event, collection)
    }
    catch {
      // Non-critical: key fetch may fail; we retry later
    }
  }
}

function getForwardedHeaders(event: H3Event | undefined) {
  const headers = event ? getRequestHeaders(event) : {}
  headers['accept-encoding'] = undefined
  return headers
}

async function fetchContent<T>(
  event: H3Event | undefined,
  path: string,
  options: NonNullable<Parameters<typeof $fetch>[1]>,
): Promise<T> {
  const fetchOptions = {
    ...options,
    headers: {
      ...getForwardedHeaders(event),
      ...options.headers,
    },
  }

  return event ? await event.$fetch(path, fetchOptions) : await $fetch(path, fetchOptions)
}

// override fetchDatabase
export async function fetchDatabase(event: H3Event | undefined, collection: string): Promise<string> {
  const encPreferred = encOn()
  const checksum = checksums[String(collection)]
  const headers = {
    'content-type': 'text/plain',
    ...(event?.node?.req?.headers?.cookie ? { cookie: event.node.req.headers.cookie } : {}),
  }
  const attempts = encPreferred
    ? [
        `/__nuxt_content/${collection}/sql_dump.enc`,
        `/__nuxt_content/${collection}/sql_dump.txt`,
      ]
    : [
        `/__nuxt_content/${collection}/sql_dump.txt`,
        `/__nuxt_content/${collection}/sql_dump.enc`,
      ]

  let lastError: unknown
  for (const path of attempts) {
    const query = { v: checksum, t: import.meta.dev ? Date.now() : undefined }
    const doFetch = async (stamp?: number) => {
      const payload = await fetchContent<string>(event, path, {
        responseType: 'text' as const,
        headers,
        query: { v: checksum, t: stamp ?? query.t },
      })

      if (!payload || !payload.trim()) {
        const error = new Error(`Empty dump payload from ${path}`)
        Object.assign(error, { status: 404 })
        throw error
      }

      return payload
    }

    try {
      return await doFetch()
    }
    catch (err) {
      if (!isRecoverable(err)) {
        throw err
      }
      lastError = err
      await selfHealOnce(event, collection)
      const retryStamp = Date.now()
      try {
        return await doFetch(retryStamp)
      }
      catch (retryErr) {
        if (!isRecoverable(retryErr)) {
          throw retryErr
        }
        lastError = retryErr
      }
    }
  }

  if (import.meta.client) {
    // Every attempt failed which usually means the browser is running an outdated bundle.
    // Force a silent refresh so the next load uses the new manifest + dumps.
    await forceClientRefresh('dump-fetch-failed', { collection })
  }
  throw lastError ?? new Error('Failed to fetch content dump')
}

// override fetchQuery
export async function fetchQuery<Item>(
  event: H3Event | undefined,
  collection: string,
  sql: string,
): Promise<Item[]> {
  const checksum = checksums[String(collection)]

  const opts = {
    method: 'POST' as const,
    headers: {
      'content-type': 'application/json',
      ...(event?.node?.req?.headers?.cookie ? { cookie: event.node.req.headers.cookie } : {}),
    },
    body: { sql },
  }
  const initialQuery = { v: checksum, t: import.meta.dev ? Date.now() : undefined }

  try {
    const rows = await fetchContent<Item[]>(
      event,
      `/__nuxt_content/${collection}/query`,
      { ...opts, query: initialQuery },
    )
    return rows
  }
  catch (e) {
    if (!isRecoverable(e)) {
      throw e
    }
    await selfHealOnce(event, collection)
    const retryStamp = Date.now()
    try {
      return await fetchContent<Item[]>(
        event,
        `/__nuxt_content/${collection}/query`,
        {
          ...opts,
          query: { v: checksum, t: retryStamp },
        },
      )
    }
    catch (retryErr) {
      if (isRecoverable(retryErr) && import.meta.client) {
        await forceClientRefresh('query-retry-failed', { collection })
      }
      throw retryErr
    }
  }
}

export async function fetchDumpKey(
  event: H3Event | undefined,
  collection: string,
  kid?: string,
): Promise<{ kid: string, k: string }> {
  return await fetchContent(event, `/__nuxt_content/${collection}/key`, {
    headers: {
      'content-type': 'application/json',
      ...(event?.node?.req?.headers?.cookie ? { cookie: event.node.req.headers.cookie } : {}),
    },
    query: kid
      ? { kid, t: import.meta.dev ? Date.now() : undefined }
      : { v: checksums[String(collection)], t: import.meta.dev ? Date.now() : undefined },
  })
}
