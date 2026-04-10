import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const compilerSfcCandidates = [
  resolve('node_modules/.pnpm/@vue+compiler-sfc@3.5.31/node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js'),
]

const pnpmDir = resolve('node_modules/.pnpm')
if (existsSync(pnpmDir)) {
  const entries = await readdir(pnpmDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const candidate = resolve(pnpmDir, entry.name, 'node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js')
    if (existsSync(candidate)) {
      compilerSfcCandidates.push(candidate)
    }
  }
}

const patches = compilerSfcCandidates.map(path => ({
  path,
  to: "var MagicString = require(path$1.join(__dirname, '../../../magic-string/dist/magic-string.cjs.js'));",
  variants: [
    "var MagicString = require('magic-string');",
    "var MagicString = require('magic-string/dist/magic-string.cjs.js');",
    "var MagicString = require(path$1.join(__dirname, '../../magic-string/dist/magic-string.cjs.js'));",
  ],
  label: '@vue/compiler-sfc -> magic-string cjs',
}))

for (const patch of patches) {
  if (!existsSync(patch.path)) {
    continue
  }

  const source = await readFile(patch.path, 'utf8')
  if (source.includes(patch.to)) {
    continue
  }
  if (source.includes(patch.to)) {
    continue
  }

  const variant = patch.variants.find(candidate => source.includes(candidate))
  if (!variant) {
    console.warn(`[patch-deps] skipped ${patch.label}: pattern not found`)
    continue
  }

  await writeFile(patch.path, source.replace(variant, patch.to), 'utf8')
  console.log(`[patch-deps] applied ${patch.label}`)
}
