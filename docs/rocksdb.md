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

## Wallet Layer Boundary

`@bsv/wallet-toolbox-rocksdb` owns the local wallet layer for Node.js BSV
applications that want RocksDB-backed wallet state:

- signer reference parsing for `wallet-toolbox://testnet/...` and
  `wallet-toolbox://mainnet/...`
- RocksDB wallet initialization and readiness inspection
- local wallet storage through `RocksDbWalletStore`
- BRC-100 wallet construction through `WalletStorageManager`
- local key resolution from caller-supplied key config paths
- spendable UTXO import and validation
- no-spend payment dry-run
- transaction construction/signing with idempotent signing records

The package does not broadcast transactions and does not own application policy,
proof materialization, receipts, or operator artifacts. Consumers should call
`signRocksDbWalletPayment` only after their own admission/idempotency/outbox
gates approve signing, then hand the returned signed transaction to their own
broadcast/proof boundary.

Public wallet APIs return redacted readiness and signing metadata only. They must
not return or log root keys, xpriv, WIF, mnemonic, seed, or raw signing material.
