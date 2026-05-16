import { readdir, readFile } from 'fs/promises'
import path from 'path'

const SOURCE_ROOT = path.join(process.cwd(), 'src')
const RUNTIME_HTTP_BANS = [
  {
    name: 'native fetch',
    pattern: /(^|[^\w.])fetch\s*\(/,
    message: 'Use the undici-backed HttpClient adapter instead of native fetch().'
  },
  {
    name: 'SDK defaultHttpClient',
    pattern: /\bdefaultHttpClient\b/,
    message: 'Use createUndiciHttpClient() for default wallet runtime HTTP clients.'
  }
]

describe('HTTP client policy', () => {
  test('runtime source uses pooled undici-backed HTTP clients', async () => {
    const sourceFiles = await listTypeScriptFiles(SOURCE_ROOT)
    const violations: string[] = []

    for (const filePath of sourceFiles) {
      const text = await readFile(filePath, 'utf8')
      const lines = text.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        for (const ban of RUNTIME_HTTP_BANS) {
          if (ban.pattern.test(line)) {
            violations.push(`${path.relative(process.cwd(), filePath)}:${index + 1}: ${ban.name} - ${ban.message}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})

async function listTypeScriptFiles (dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__tests' || entry.name === '__test') continue
      files.push(...await listTypeScriptFiles(entryPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(entryPath)
  }

  return files
}
