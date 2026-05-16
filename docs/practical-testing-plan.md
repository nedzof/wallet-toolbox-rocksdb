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

Run the practical test phase against a real testnet wallet, on-disk RocksDB, and
real provider endpoints. Use the same signed transaction data and txid for every
provider retry.

Recommended ladder:

1. 10 tx/s for 10 seconds
2. 10 tx/s for 60 seconds
3. 100 tx/s for 60 seconds
4. 500 tx/s for 60 seconds
5. 1000 tx/s only after provider outcomes, proof finality, cache invalidation,
   and wallet storage state reconcile cleanly at the lower rungs

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

## Expected Bottleneck Search

When throughput fails to scale, classify the first bottleneck before changing
architecture:

- ARC/WhatsOnChain/Bitails response latency or provider throttling;
- target-disk RocksDB write throughput;
- secondary index maintenance cost per output;
- transaction construction or BEEF serialization CPU;
- proof/finality reconciliation lag;
- cache churn that prevents the expected UTXO hit rate.

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
