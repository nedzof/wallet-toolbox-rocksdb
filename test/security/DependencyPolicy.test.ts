import { readdir, readFile } from 'fs/promises'
import path from 'path'

const FORBIDDEN_RUNTIME_PACKAGES = ['bullmq', 'ioredis', 'redis', 'better-sqlite3', 'sqlite3']
const SQLITE_SURFACE_PATTERN = /\bsqlite\b|better-sqlite3|sqlite3|createWalletSQLite|createSQLiteKnex|SetupWalletSQLite|sqliteFilename/i
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies'
] as const
const SOURCE_ROOT = path.join(process.cwd(), 'src')
const FIRST_PARTY_SQLITE_ALLOWLIST = new Set([
  '.dependency-cruiser.js',
  'docs/refactor-rocksdb-implementation-audit.md',
  'package-lock.json',
  'test/security/DependencyPolicy.test.ts'
])
const SCAN_EXTENSIONS = new Set(['.js', '.json', '.md', '.ts', '.yaml', '.yml'])
const SKIPPED_SCAN_DIRS = new Set([
  '.git',
  'client/out',
  'docs/open-rpc',
  'mobile/out',
  'node_modules',
  'out'
])
const FORBIDDEN_RUNTIME_IMPORT = new RegExp(
  String.raw`(?:from\s+['"](${FORBIDDEN_RUNTIME_PACKAGES.join('|')})(?:/[^'"]*)?['"]|` +
  String.raw`import\s*\(\s*['"](${FORBIDDEN_RUNTIME_PACKAGES.join('|')})(?:/[^'"]*)?['"]\s*\)|` +
  String.raw`require\s*\(\s*['"](${FORBIDDEN_RUNTIME_PACKAGES.join('|')})(?:/[^'"]*)?['"]\s*\))`
)
const ALLOWED_LOCKFILE_FORBIDDEN_PACKAGE_KEYS = [
  'packages.node_modules/knex.peerDependenciesMeta.better-sqlite3',
  'packages.node_modules/knex.peerDependenciesMeta.sqlite3'
]

describe('dependency policy', () => {
  test('wallet-toolbox-rocksdb does not directly depend on excluded runtimes', async () => {
    const manifest = await readJson<Record<string, any>>('package.json')
    const packageLock = await readJson<Record<string, any>>('package-lock.json')
    const rootLockPackage = packageLock.packages?.[''] ?? {}

    for (const field of DEPENDENCY_FIELDS) {
      expectForbiddenPackagesAbsent(`package.json ${field}`, manifest[field])
      expectForbiddenPackagesAbsent(`package-lock root ${field}`, rootLockPackage[field])
    }
  })

  test('package lock does not install excluded runtime packages', async () => {
    const packageLock = await readJson<Record<string, any>>('package-lock.json')
    const packagePaths = Object.keys(packageLock.packages ?? {})
    for (const name of FORBIDDEN_RUNTIME_PACKAGES) {
      expect(packagePaths).not.toContain(`node_modules/${name}`)
    }
  })

  test('runtime source does not import excluded runtime packages', async () => {
    const sourceFiles = await listTypeScriptFiles(SOURCE_ROOT)
    const violations: string[] = []

    for (const filePath of sourceFiles) {
      const text = await readFile(filePath, 'utf8')
      const lines = text.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (FORBIDDEN_RUNTIME_IMPORT.test(line)) {
          violations.push(`${path.relative(process.cwd(), filePath)}:${index + 1}: excluded runtime import`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  test('first-party tree does not expose SQLite surface outside policy and audit evidence', async () => {
    const files = await listPolicyScannedFiles(process.cwd())
    const violations: string[] = []

    for (const filePath of files) {
      const relativePath = toRelativeRepoPath(filePath)
      if (FIRST_PARTY_SQLITE_ALLOWLIST.has(relativePath)) continue

      const text = await readFile(filePath, 'utf8')
      const lines = text.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (SQLITE_SURFACE_PATTERN.test(line)) {
          violations.push(`${relativePath}:${index + 1}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  test('package lock SQLite references are limited to Knex optional peer metadata', async () => {
    const packageLock = await readJson<Record<string, any>>('package-lock.json')
    const forbiddenKeyPaths = collectForbiddenPackageKeys(packageLock)

    expect(forbiddenKeyPaths).toEqual(ALLOWED_LOCKFILE_FORBIDDEN_PACKAGE_KEYS)
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

async function listPolicyScannedFiles (dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    const relativePath = toRelativeRepoPath(entryPath)
    if (entry.isDirectory()) {
      if (shouldSkipScanDir(relativePath)) continue
      files.push(...await listPolicyScannedFiles(entryPath))
      continue
    }
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath)
  }

  return files
}

function shouldSkipScanDir (relativePath: string): boolean {
  return SKIPPED_SCAN_DIRS.has(relativePath)
}

function toRelativeRepoPath (filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/')
}

function collectForbiddenPackageKeys (value: unknown, prefix = ''): string[] {
  if (value == null || typeof value !== 'object') return []

  const paths: string[] = []
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = prefix ? `${prefix}.${key}` : key
    if (FORBIDDEN_RUNTIME_PACKAGES.includes(key)) paths.push(currentPath)
    paths.push(...collectForbiddenPackageKeys(nestedValue, currentPath))
  }

  return paths
}
