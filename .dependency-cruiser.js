module.exports = {
  forbidden: [
    {
      name: 'no-redis-bullmq-sqlite',
      severity: 'error',
      comment: 'wallet-toolbox runtime must not depend on Redis, BullMQ, or SQLite runtimes.',
      from: { path: '^src' },
      to: { dependencyTypes: ['npm'], path: '^(bullmq|ioredis|redis|better-sqlite3|sqlite3)$' }
    },
    {
      name: 'cache-no-storage-implementation',
      severity: 'error',
      comment: 'Cache helpers must stay independent of concrete storage implementations.',
      from: { path: '^src/cache' },
      to: { path: '^src/storage/rocksdb' }
    },
    {
      name: 'cache-in-memory-only',
      severity: 'error',
      comment: 'Single-instance cache helpers may use only in-memory cache/event packages.',
      from: { path: '^src/cache' },
      to: { dependencyTypes: ['npm'], pathNot: '^(lru-cache|node-cache|eventemitter3)$' }
    },
    {
      name: 'events-no-business-logic',
      severity: 'error',
      comment: 'The event bus is coordination only; it must not depend on runtime business layers.',
      from: { path: '^src/events' },
      to: { path: '^src/(storage|services|monitor|cache|broadcast)' }
    },
    {
      name: 'events-eventemitter3-only',
      severity: 'error',
      comment: 'The event bus must remain an eventemitter3 wrapper, not an application runtime.',
      from: { path: '^src/events' },
      to: { dependencyTypes: ['npm'], pathNot: '^eventemitter3$' }
    },
    {
      name: 'broadcast-no-storage-implementation',
      severity: 'error',
      comment: 'Broadcast orchestration must not depend on a concrete storage backend.',
      from: { path: '^src/broadcast' },
      to: { path: '^src/storage/rocksdb' }
    },
    {
      name: 'messaging-no-business-layers',
      severity: 'error',
      comment: 'Wallet-local messaging adapters must not own storage, monitor, or service-provider runtime logic.',
      from: { path: '^src/messaging' },
      to: { path: '^src/(storage|monitor|services)' }
    },
    {
      name: 'messaging-no-external-runtime',
      severity: 'error',
      comment: 'Wallet messaging adapters may use NATS only; other external runtime buses remain banned.',
      from: { path: '^src/messaging' },
      to: { dependencyTypes: ['npm'], pathNot: '^nats$' }
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies are tracked as warnings until the existing codebase is cleaned up.',
      from: {},
      to: { circular: true }
    }
  ],
  options: {
    tsConfig: {
      fileName: 'tsconfig.depcruise.json'
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default', 'node']
    },
    doNotFollow: {
      path: 'node_modules'
    },
    exclude: {
      path: '^(out|test|client|mobile|node_modules)/|^src/.*/(__test|__tests|__tests__)(/|$)|\\.sqlite$'
    },
    progress: {
      type: 'none'
    }
  }
}
