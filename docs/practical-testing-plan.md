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

Prerequisites:

- Nektar runtime checkout available through `TESTNET_LOAD_NEKTAR_RUN_ROOT`
  or the default sibling path `../nektar-run`;
- SPV Wallet/paymail environment loaded for that runtime, including
  `NEKTAR_SPV_WALLET_URL`, treasury sender credentials, and provider settings;
- recipient paymail in `TESTNET_LOAD_RECIPIENT_PAYMAIL` or
  `NEKTAR_LIVE_SETTLEMENT_RECIPIENT_PAYMAIL`;
- funded SPV Wallet treasury slots for the selected sender agent.

The live harness is SPV/paymail-only. It no longer discovers or imports legacy
P2PKH UTXOs through WhatsOnChain.

Run:

```bash
TESTNET_LOAD_ENABLED=1 \
TESTNET_LOAD_NEKTAR_RUN_ROOT=/path/to/nektar-run \
TESTNET_LOAD_RECIPIENT_PAYMAIL=alice@example.com \
npm run loadtest:testnet
```

With `TESTNET_LOAD_ENABLED` unset, `npm run loadtest:testnet` is CI-safe and
prints a skip message before exiting 0.

Recommended ladder:

1. 10 tx/s for 10 seconds
2. 50 tx/s for 10 seconds
3. 100 tx/s for 10 seconds
4. 500 tx/s for 10 seconds
5. 1000 tx/s for 10 seconds, only after provider outcomes, proof finality,
   cache invalidation,
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

The harness prints each Nektar circulation report and a summary table with
actual TPS, latency percentiles where the report exposes them, failed counts,
and the first SPV/paymail or provider blocker.

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

Success criteria:

- sustained 1000 tx/s for 10 seconds;
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
