import { describe, expect, it } from 'vitest'
import { isRawMarkdownEnabledForCollection, resolveContentRawMarkdownOptions } from '../../src/features/llms/utils'

describe('llms raw markdown policy', () => {
  it('keeps public collections enabled by default', () => {
    expect(isRawMarkdownEnabledForCollection('blog', undefined, {
      encryptionEnabled: true,
    })).toBe(true)
  })

  it('treats configured private collections as opt-in when encryption is enabled', () => {
    const options = resolveContentRawMarkdownOptions({
      privateCollections: ['course_tcp'],
    })

    expect(isRawMarkdownEnabledForCollection('course_tcp', options, {
      encryptionEnabled: true,
    })).toBe(false)

    expect(isRawMarkdownEnabledForCollection('blog', options, {
      encryptionEnabled: true,
    })).toBe(true)
  })

  it('allows explicitly included private collections when encryption is enabled', () => {
    const options = resolveContentRawMarkdownOptions({
      privateCollections: ['course_tcp'],
      includeCollections: ['course_tcp'],
    })

    expect(isRawMarkdownEnabledForCollection('course_tcp', options, {
      encryptionEnabled: true,
    })).toBe(true)
  })

  it('does not require opt-in for private collections when encryption is disabled', () => {
    const options = resolveContentRawMarkdownOptions({
      privateCollections: ['course_tcp'],
    })

    expect(isRawMarkdownEnabledForCollection('course_tcp', options, {
      encryptionEnabled: false,
    })).toBe(true)
  })

  it('respects manifest private collections as opt-in when encryption is enabled', () => {
    expect(isRawMarkdownEnabledForCollection('info', {}, {
      encryptionEnabled: true,
      collectionMeta: { private: true },
    })).toBe(false)

    expect(isRawMarkdownEnabledForCollection('info', {
      includeCollections: ['info'],
    }, {
      encryptionEnabled: true,
      collectionMeta: { private: true },
    })).toBe(true)
  })

  it('always honors hard excludes', () => {
    const options = resolveContentRawMarkdownOptions({
      privateCollections: ['course_tcp'],
      includeCollections: ['course_tcp'],
      excludeCollections: ['course_tcp', 'blog'],
    })

    expect(isRawMarkdownEnabledForCollection('course_tcp', options, {
      encryptionEnabled: true,
    })).toBe(false)

    expect(isRawMarkdownEnabledForCollection('blog', options, {
      encryptionEnabled: false,
    })).toBe(false)
  })

  it('disables all collections when contentRawMarkdown is false', () => {
    expect(isRawMarkdownEnabledForCollection('blog', false, {
      encryptionEnabled: false,
    })).toBe(false)
  })
})
