import { readFileSync } from 'fs'

describe('banned distributed runtime dependencies', () => {
  test('package manifest does not depend on Redis or BullMQ runtimes', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const banned = ['redis', 'ioredis', 'bullmq', 'bull']

    for (const dep of banned) {
      expect(pkg.dependencies?.[dep]).toBeUndefined()
      expect(pkg.devDependencies?.[dep]).toBeUndefined()
    }
  })
})
