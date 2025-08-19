// src/presets/shared-dumps.ts
import type { NitroConfig } from 'nitropack'
import type { Manifest } from '../types/manifest'
import { addTemplate } from '@nuxt/kit'
import { join } from 'pathe'
import { logger } from '../utils/dev'
import { collectionDumpTemplate, collectionEncryptedDumpTemplate, fullDatabaseCompressedDumpTemplate } from '../utils/templates'

export interface ApplyDumpsOptions {
  manifest: Manifest
  resolver: { resolve: (p: string) => string }
  moduleOptions: { encryption?: { enabled?: boolean, masterKey?: string } }
  platform: 'cloudflare' | 'node' | 'nuxthub'
  exposePublicAssets?: boolean // default true (you allow public, but encrypted)
  includeLegacyCompressedModule?: boolean // default true for node preset
}

/**
 * One place to:
 * - emit per-collection templates (.sql or .sql.enc)
 * - expose content/raw if desired
 * - register handlers for dump + key endpoints
 * - wire legacy compressed dump module if needed (node)
 */
export function applyContentDumpsPreset(
  nitroConfig: NitroConfig,
  { manifest, resolver, moduleOptions, platform, exposePublicAssets = true, includeLegacyCompressedModule = platform === 'node' }: ApplyDumpsOptions,
) {
  const encryptionEnabled = !!moduleOptions?.encryption?.enabled
  const masterKey = moduleOptions?.encryption?.masterKey

  nitroConfig.publicAssets ||= []
  nitroConfig.alias ||= {}
  nitroConfig.handlers ||= []

  // 1) Expose /_nuxt/content/raw if you want CDN to serve blobs
  if (exposePublicAssets) {
    nitroConfig.publicAssets.push({ dir: join(nitroConfig.buildDir!, 'content', 'raw'), maxAge: 60 })
  }

  // 2) Emit per-collection dump templates (skip private)
  for (const col of manifest.collections) {
    if (col.private) continue
    if (encryptionEnabled) {
      if (!masterKey) {
        logger.warn(`[content] encryption.enabled is true but no masterKey provided; falling back to plaintext dump for "${col.name}".`)
        addTemplate(collectionDumpTemplate(col.name, manifest))
      }
      else {
        addTemplate(collectionEncryptedDumpTemplate(col.name, manifest, { enabled: true, masterKey }))
      }
    }
    else {
      addTemplate(collectionDumpTemplate(col.name, manifest))
    }
  }

  // 3) Legacy single-file compressed module (node only; backward-compat)
  if (includeLegacyCompressedModule) {
    nitroConfig.alias['#content/dump'] = addTemplate(fullDatabaseCompressedDumpTemplate(manifest)).dst
  }

  // 4) Route handlers: platform-specific handler file, same routes
  const handlerPath
    = platform === 'cloudflare'
      ? './runtime/presets/cloudflare/database-handler'
      : './runtime/presets/node/database-handler' // node + nuxthub reuse node handler code

  if (!encryptionEnabled) {
    nitroConfig.handlers.push({
      route: '/__nuxt_content/:collection/sql_dump.txt',
      handler: resolver.resolve(handlerPath),
    })
  }
  else {
    nitroConfig.handlers.push(
      { route: '/__nuxt_content/:collection/sql_dump.enc', handler: resolver.resolve(handlerPath) },
      { route: '/api/__nuxt_content/:collection/key', handler: resolver.resolve(handlerPath) },
      // optional: ensure .txt 404s via same handler in encrypted mode
      { route: '/__nuxt_content/:collection/sql_dump.txt', handler: resolver.resolve(handlerPath) },
    )
  }
}
