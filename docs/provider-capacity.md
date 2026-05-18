# Provider Capacity Notes

Generated for the RocksDB scaling refactor.

## Live Harness Gate

`npm run loadtest:testnet` is disabled unless `TESTNET_LOAD_ENABLED=1`.
When enabled, the harness requires:

- `ARC_URL` or a Nektar ARC alias such as `NEKTAR_ARC_URL`
- `ARC_API_KEY` or a Nektar token alias such as `NEKTAR_ARC_TOKEN`
- one wallet source: preferably `TESTNET_WALLET_TOOLBOX_SIGNER_CONFIG`
  / `NEKTAR_AUTONOMOUS_TESTNET_SIGNER_CONFIG` for the Nektar
  wallet-toolbox/paymail path, or legacy `TESTNET_WALLET_ROOT_KEY_HEX`,
  `TESTNET_WALLET_ROOT_KEY_FILE`, or `TESTNET_WALLET_WIF`

Optional inputs:

- `TESTNET_LOAD_OUTPOINTS`
- `TESTNET_LOAD_CREATE_CONCURRENCY`
- `TESTNET_LOAD_POST_BEEF_CONCURRENCY`
- `TESTNET_LOAD_ROCKSDB_PARALLELISM`
- `NATS_URL`
- `WALLET_TOOLBOX_NATS_STREAM_MAX_BYTES`, or per-stream overrides such as
  `WALLET_TOOLBOX_NATS_PROOF_REQUESTS_MAX_BYTES`,
  `WALLET_TOOLBOX_NATS_CACHE_INVALIDATE_MAX_BYTES`, and
  `WALLET_TOOLBOX_NATS_DEAD_LETTER_MAX_BYTES` for constrained JetStream
  brokers

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

Current Nektar env discovery resolves ARC to `https://arc.gorillapool.io` and
SPV Wallet broadcast to `http://nektar.run:3003`. The local signer-config
live run reaches the wallet-toolbox RocksDB inventory and imports the funded
paymail outpoints, but Stage 1 currently stops at 2.51 TPS with
`storage_manager_writer_serialization` as the first bottleneck. Provider queues
remain empty and RocksDB storage p95 is 1 ms, so provider scale should not be
changed until the wallet writer/createAction path clears Stage 1.
