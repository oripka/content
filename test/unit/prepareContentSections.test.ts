import { describe, expect, it, vi } from 'vitest'
import type { LLMsSection } from 'nuxt-llms'
import { prepareContentSections } from '../../src/features/llms/runtime/server/utils'

vi.mock('#content/manifest', () => ({
  default: {
    docs: { type: 'page' },
    blog: { type: 'page' },
    data: { type: 'data' },
  },
}))

describe('prepareContentSections', () => {
  it('adds draft/private filters to auto-generated content sections', () => {
    const sections: LLMsSection[] = []

    prepareContentSections(sections)

    expect(sections).toEqual([
      expect.objectContaining({
        title: 'Docs',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'extension', operator: '=', value: 'md' },
          { field: 'draft', operator: '<>', value: true },
          { field: 'private', operator: '<>', value: true },
        ],
      }),
      expect.objectContaining({
        title: 'Blog',
        contentCollection: 'blog',
        contentFilters: [
          { field: 'extension', operator: '=', value: 'md' },
          { field: 'draft', operator: '<>', value: true },
          { field: 'private', operator: '<>', value: true },
        ],
      }),
    ])
  })

  it('does not auto-generate sections when content sections already exist', () => {
    const sections: LLMsSection[] = [
      {
        title: 'Custom',
        contentCollection: 'docs',
      } as LLMsSection,
    ]

    prepareContentSections(sections)

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      title: 'Custom',
      contentCollection: 'docs',
    })
  })
})
