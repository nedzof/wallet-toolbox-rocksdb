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
- `findEntities({ prefix, limit })`
- `putOutput(output)`
- `updateOutput(output)`
- `deleteOutput(outputId)`
- `findOutputsByScriptHash(scriptHash, limit?)`
- `findSpendableOutputs(userId, basketId?, limit?)`
- `findOutputsByOutpoints(userId, outpoints)`
- `rebuildOutputIndexes()`
- `getTuningOptions()`
- `flush()`
- `compact({ prefix? })`
- `prepareForFilesystemSnapshot({ compact? })`
- `close()`

## Output Indexes

`putOutput` stores the primary output record and maintains secondary index
records in the same RocksDB transaction. The current wallet-owned indexes are:

- `scriptHash -> outputId`
- `userId + spendable -> outputId`
- `userId + basketId + spendable -> outputId`
- `userId + txid + vout -> outputId`

The index lookup helpers resolve index records back to primary output records
with bounded parallelism. Script-hash, spendable, and user-scoped outpoint
lookups also re-check the resolved primary records, so stale secondary index
records cannot return mismatched outputs. `rebuildOutputIndexes()` drops
existing output index records and recreates them from primary output records,
which is useful after bulk imports or metadata backfills.

## Tuning

`RocksDbWalletStore.open` defaults `parallelismThreads` to `12` for the
throughput-oriented fork. It also exposes the RocksDB options supported by the
current `@harperfast/rocksdb-js` binding:

- `disableWAL`
- `enableStats`
- `noBlockCache`
- `pessimistic`
- `readOnly`
- `statsLevel`
- `transactionLogMaxAgeThreshold`
- `transactionLogMaxSize`
- `transactionLogRetention`
- `transactionLogsPath`
- `blockCacheSize`
- `compactOnClose`

The binding does not currently expose write-buffer or level-compaction options.
Use `getTuningOptions()` to inspect the active store configuration.

## Snapshot Handoff

`prepareForFilesystemSnapshot({ compact })` flushes pending writes and can
compact the namespace before returning the database path. The actual filesystem
snapshot remains operator-owned because the current RocksDB binding does not
expose a checkpoint or online backup API.

Recommended operator flow:

1. Quiesce wallet writes or run on storage that provides crash-consistent volume
   snapshots.
2. Call `prepareForFilesystemSnapshot({ compact: true })` and wait for it to
   return the database path.
3. Snapshot the returned path with the platform snapshot tool.
4. Restore into staging and open the restored database before relying on the
   snapshot procedure.

Do not treat an ordinary recursive copy of a live RocksDB directory as a
point-in-time backup. Without a binding-level checkpoint API, safe online
backup semantics must come from the surrounding storage platform.

## Guarantees

- Records are namespaced.
- Records carry a schema version.
- Writes increment per-record versions.
- `expectedVersion` enforces optimistic concurrency.
- `batch` uses a RocksDB transaction.
- Prefix scans are bounded by `limit`.
- Secondary output indexes are maintained transactionally by `putOutput`,
  `updateOutput`, and `deleteOutput`.
- Secondary index lookups verify resolved primary records before returning
  results.
- `compact` is namespace-aware and may be scoped to a wallet-store prefix.

## Current Boundary

This package remains a wallet library. RocksDB owns wallet storage and local
indexes; application-runtime concerns such as Redis, BullMQ, NATS JetStream,
lane fanout, and proof queues belong outside this package.
