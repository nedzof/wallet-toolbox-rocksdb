# RocksDB Storage Extension

`@bsv/wallet-toolbox-rocksdb` is a standalone fork of upstream
`@bsv/wallet-toolbox` from `bsv-blockchain/ts-stack`.

The first RocksDB extension is `RocksDbWalletStore`, exported from the normal
Node package surface via `src/storage/index.all.ts`.

## API

- `RocksDbWalletStore.open(options)`
- `get(key)`
- `put({ key, value, expectedVersion, updated_at })`
- `delete(key)`
- `batch(writes)`
- `scan({ prefix, limit })`
- `flush()`
- `close()`

## Guarantees

- Records are namespaced.
- Records carry a schema version.
- Writes increment per-record versions.
- `expectedVersion` enforces optimistic concurrency.
- `batch` uses a RocksDB transaction.
- Prefix scans are bounded by `limit`.

## Current Boundary

This is a storage primitive, not yet a full replacement for every
`WalletStorageProvider` method. The next migration step is mapping the existing
wallet tables onto this primitive while preserving BRC-100 wallet behavior.
