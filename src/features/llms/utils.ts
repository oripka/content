import defu from 'defu'

export type ContentRawMarkdownOptions = false | {
  rewriteLLMSTxt?: boolean
  excludeCollections?: string[]
  privateCollections?: string[]
  includeCollections?: string[]
}

export type LLMCollectionMeta = {
  type?: string
  private?: boolean
}

export function resolveContentRawMarkdownOptions(
  contentRawMarkdown: ContentRawMarkdownOptions | undefined,
) {
  return contentRawMarkdown === false
    ? false
    : defu(contentRawMarkdown, {
        excludeCollections: [],
        privateCollections: [],
        includeCollections: [],
      })
}

export function isRawMarkdownEnabledForCollection(
  collection: string,
  contentRawMarkdown: ContentRawMarkdownOptions | undefined,
  opts: {
    encryptionEnabled?: boolean
    collectionMeta?: LLMCollectionMeta
  } = {},
) {
  const resolved = resolveContentRawMarkdownOptions(contentRawMarkdown)
  if (resolved === false) {
    return false
  }

  if (resolved.excludeCollections.includes(collection)) {
    return false
  }

  const isPrivate = Boolean(
    opts.collectionMeta?.private
    || (opts.encryptionEnabled && resolved.privateCollections.includes(collection)),
  )

  if (isPrivate && opts.encryptionEnabled) {
    return resolved.includeCollections.includes(collection)
  }

  return true
}
