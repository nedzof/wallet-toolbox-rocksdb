# Provider Capacity Notes

Generated for the RocksDB scaling refactor.

## Live Harness Gate

`npm run loadtest:testnet` is disabled unless `TESTNET_LOAD_ENABLED=1`.
When enabled, the harness requires:

- `ARC_URL`
- `ARC_API_KEY`
- `TESTNET_WALLET_WIF`

Optional inputs:

- `TESTNET_LOAD_OUTPOINTS`
- `TESTNET_LOAD_CREATE_CONCURRENCY`
- `TESTNET_LOAD_POST_BEEF_CONCURRENCY`
- `TESTNET_LOAD_ROCKSDB_PARALLELISM`
- `NATS_URL`

## Staged Ceiling For This Refactor

The current validation ladder stops at `50tps-10s`:

- `10tps-10s`
- `10tps-60s`
- `50tps-10s`

The run writes `.tmp/wallet-toolbox-throughput-safety/latest.json`.

## Capacity Signals

Treat the following as provider or infrastructure limits instead of wallet logic success:

- sustained HTTP 429 or rate-limit responses
- `postBeef` queue backlog
- p95 broadcast latency at or above 500 ms
- storage p95 at or above 500 ms
- UTXO exhaustion in the funded testnet wallet

Provider scale should be increased only after the artifact shows the previous stage met target TPS without broadcast retry growth, storage backlog, or rate-limit bottlenecks.
