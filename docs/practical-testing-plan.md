# Practical Testing Plan

Date: 2026-05-16

`npm run loadtest:single-instance` is a mocked in-process queue/concurrency
harness. It proves that the single-instance broadcast queue can keep bounded
parallel work moving, but it does not prove production 1000 tx/s.

That mocked harness intentionally does not exercise:

- real RocksDB writes or compaction pressure;
- real provider HTTP latency to ARC, WhatsOnChain, or Bitails;
- real BEEF serialization or transaction construction cost;
- public testnet/mainnet mining, proof finality, or reorg behavior.

## Testnet Ramp

Run the practical test phase against a real testnet wallet key, on-disk RocksDB,
and real provider endpoints. The harness opens `StorageRocksDb`, creates a
`Wallet` with `Services` on `chain='test'`, imports funded P2PKH UTXOs for the
configured testnet key, then creates P2PKH self-send transactions through
`wallet.createAction`.

Prerequisites:

- `TESTNET_LOAD_ENABLED=1`;
- `ARC_URL` for the testnet ARC broadcaster;
- `ARC_API_KEY` for the testnet ARC broadcaster;
- `TESTNET_WALLET_WIF`, a funded testnet P2PKH key;
- optional `TESTNET_LOAD_OUTPOINTS` as comma-separated `txid.vout` values when
  provider discovery should be bypassed;
- enough funded UTXOs for the selected stage, or the run will stop cleanly with
  a UTXO exhaustion classification.

Run:

```bash
TESTNET_LOAD_ENABLED=1 \
ARC_URL=https://arc-test.taal.com \
ARC_API_KEY=... \
TESTNET_WALLET_WIF=... \
npm run loadtest:testnet
```

With `TESTNET_LOAD_ENABLED` unset, `npm run loadtest:testnet` is CI-safe and
prints a skip message before exiting 0.

Recommended ladder:

1. 10 tx/s for 10 seconds
2. 10 tx/s for 60 seconds
3. 50 tx/s for 10 seconds

Do not raise the target above 50 tx/s until provider outcomes, proof finality,
cache invalidation, and wallet storage state reconcile cleanly at these rungs.

## Required Observability

Capture Prometheus metrics and logs for:

- provider broadcast latency and result classification;
- broadcast queue depth and active concurrency;
- SendWaiting backlog;
- UTXO cache hit/miss rate, with a target of at least 90% for workloads that are
  expected to reuse recent UTXO status;
- RocksDB get/put/delete/batch/scan/compact latency;
- secondary index rebuild/query timings;
- block-header cache hit/miss rate;
- SPV header/reorg events and cache invalidation counts.

The harness prints each stage result, full Prometheus text after every stage,
and a summary table with actual TPS, latency percentiles, failed counts, cache
hit rates, RocksDB/provider queue metrics, and the first UTXO, provider, or
wallet blocker.

## Expected Bottleneck Search

When throughput fails to scale, classify the first bottleneck before changing
architecture:

- ARC/WhatsOnChain/Bitails response latency or provider throttling;
- target-disk RocksDB write throughput;
- secondary index maintenance cost per output;
- transaction construction or BEEF serialization CPU;
- proof/finality reconciliation lag;
- cache churn that prevents the expected UTXO hit rate.

Decision tree:

- If ARC latency or rate limits dominate, add more providers or move fanout into
  Nektar runtime workers.
- If RocksDB write/query p95 dominates, investigate binding support for write
  batching, checkpoints, and compaction/write-buffer tuning.
- If UTXO cache misses dominate, tune TTL/max entries and verify invalidation
  events are not clearing the whole cache unnecessarily.
- If queue backlog grows, tune provider and SendWaiting concurrency limits, then
  re-run the same staged ramp.

Success criteria for this phase:

- clean 50 tx/s for 10 seconds;
- p99 `createAction` latency under 500ms;
- no growth in postBeef or SendWaiting queue backlog at the end of the stage;
- no unreconciled failed broadcasts.

## Reorg And Cache Safety

Replay simulated reorg events during active load and verify:

- cached UTXO hints are invalidated;
- block-header cache entries from deactivated headers are removed;
- no cache result is copied into wallet spendability state as authority;
- fresh provider checks still gate spendability mutations.

## Nektar Adapter Phase

Distributed scaling belongs in Nektar, not wallet-toolbox. The adapter phase
should implement the contracts in `docs/nektar-runtime-handoff.md` and verify:

- durable `TX_BROADCAST` work is enqueued only after wallet-toolbox persists one
  signed outbox/proven-tx request;
- retries reuse the same signed transaction and same txid;
- provider disagreement is recorded per attempt and reconciled asynchronously;
- `BLOCK_EVENTS` and `UTXO_STATUS` bridge into wallet-local cache invalidation
  without becoming spend authority.
