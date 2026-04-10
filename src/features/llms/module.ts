import defu from 'defu'
import { createResolver, defineNuxtModule, addTypeTemplate, addServerPlugin, addServerHandler } from '@nuxt/kit'
import { resolveContentRawMarkdownOptions } from './utils'

export default defineNuxtModule({
  meta: {
    name: 'Content LLMS',
    configKey: 'content.llms',
  },
  setup(_opts, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    addServerPlugin(resolve('runtime/server/content-llms.plugin'))

    const encryptionEnabled = !!(nuxt.options.runtimeConfig.content as { encryption?: { enabled?: boolean } } | undefined)?.encryption?.enabled
    const llmsOption = (nuxt.options as unknown as { llms: { contentRawMarkdown: false | { excludeCollections: string[], privateCollections: string[], includeCollections: string[] } } })?.llms
    const contentRawMarkdown = resolveContentRawMarkdownOptions(llmsOption?.contentRawMarkdown)
    if (contentRawMarkdown !== false) {
      addServerHandler({ route: '/raw/**:slug.md', handler: resolve('runtime/server/routes/raw/[...slug].md.get') })
    }

    nuxt.hook('modules:done', () => {
      const contentRawMarkdown = resolveContentRawMarkdownOptions(llmsOption?.contentRawMarkdown)
      // @ts-expect-error -- TODO: fix types
      nuxt.options.llms ||= {}
      // @ts-expect-error -- TODO: fix types
      nuxt.options.llms.contentRawMarkdown = contentRawMarkdown
      // @ts-expect-error -- TODO: fix types
      nuxt.options.llms.encryptionEnabled = encryptionEnabled

      nuxt.options.runtimeConfig.llms ||= {}
      // @ts-expect-error -- TODO: fix types
      nuxt.options.runtimeConfig.llms.contentRawMarkdown = contentRawMarkdown
      nuxt.options.runtimeConfig.llms.encryptionEnabled = encryptionEnabled
    })

    const typeTemplate = addTypeTemplate({
      filename: 'content/llms.d.ts' as `${string}.d.ts`,
      getContents: () => {
        return `
import type { SQLOperator, PageCollections, PageCollectionItemBase } from '@nuxt/content'
declare module 'nuxt-llms' {
  interface ModuleOptions {
    contentRawMarkdown?: false | {
      /**
       * Whether to rewrite the LLMs.txt file to use the raw markdown endpoint
       * @default true
       */
      rewriteLLMSTxt?: boolean
      /**
       * Whether to exclude specific collections from the raw markdown endpoint
       * @default []
       */
      excludeCollections?: string[]
      /**
       * Collections treated as private when content encryption is enabled.
       * These collections require explicit opt-in via includeCollections.
       * @default []
       */
      privateCollections?: string[]
      /**
       * Collections explicitly allowed on the raw markdown endpoint when encryption
       * is enabled and they are listed in privateCollections.
       * @default []
       */
      includeCollections?: string[]
    }
    /**
     * @internal
     */
    encryptionEnabled?: boolean
  }
  interface LLMsSection {
    contentCollection?: string | keyof PageCollections
    contentFilters?: Array<{
      field: string
      operator: SQLOperator
      value?: string | number | boolean | null
    }>
  }
}

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    'content:llms:generate:document': (event: H3Event, doc: PageCollectionItemBase, options: ModuleOptions) => void
  }
}
        `
      },
      write: true,
    }, { node: true }).dst
    nuxt.options.nitro ||= {}
    nuxt.options.nitro.typescript ||= {}
    nuxt.options.nitro.typescript.tsConfig = defu(nuxt.options.nitro.typescript.tsConfig, {
      include: [typeTemplate],
    })
  },
})
