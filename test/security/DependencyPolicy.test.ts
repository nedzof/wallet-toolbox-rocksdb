import { readFile } from 'fs/promises'
import path from 'path'

const FORBIDDEN_RUNTIME_PACKAGES = ['bullmq', 'ioredis', 'redis', 'nats']
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies'
] as const

describe('dependency policy', () => {
  test('wallet-toolbox-rocksdb does not directly depend on external queue or distributed cache runtimes', async () => {
    const manifest = await readJson<Record<string, any>>('package.json')
    const packageLock = await readJson<Record<string, any>>('package-lock.json')
    const rootLockPackage = packageLock.packages?.[''] ?? {}

    for (const field of DEPENDENCY_FIELDS) {
      expectForbiddenPackagesAbsent(`package.json ${field}`, manifest[field])
      expectForbiddenPackagesAbsent(`package-lock root ${field}`, rootLockPackage[field])
    }
  })
})

async function readJson<T> (relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(process.cwd(), relativePath), 'utf8')) as T
}

function expectForbiddenPackagesAbsent (label: string, dependencyMap: unknown): void {
  if (dependencyMap == null) return
  expect(typeof dependencyMap).toBe('object')
  const dependencyNames = Object.keys(dependencyMap as Record<string, unknown>)
  for (const name of FORBIDDEN_RUNTIME_PACKAGES) {
    expect(dependencyNames).not.toContain(name)
  }
}
