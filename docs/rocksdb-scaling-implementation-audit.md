# rocksdb_scaling.md Implementation Audit

Date: 2026-05-18

Source objective: implement `docs/rocksdb_scaling.md` for
`wallet-toolbox-rocksdb`.

## Completion Decision

The wallet-toolbox-owned implementation work is complete for the critical
rebroadcast bug fix and the real-network testnet harness. Final end-to-end
production readiness is not fully provable in this checkout because the live
testnet run requires funded credentials that are not present in the environment,
and the distributed Nektar runtime adapter work belongs outside this package.

## Prompt-To-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Increase test unproven proof limit to 100 | `src/monitor/Monitor.ts` default `unprovenAttemptsLimitTest: 100` | Implemented |
| Track whether a request was broadcast | `TableProvenTxReq.wasBroadcast`, migration `2026-04-30-001`, `EntityProvenTxReq.wasBroadcast` | Implemented |
| Track rebroadcast attempts | `TableProvenTxReq.rebroadcastAttempts`, migration `2026-04-30-001`, `EntityProvenTxReq.rebroadcastAttempts` | Implemented |
| Reset broadcast proof timeouts to `unsent` | `EntityProvenTxReq.applyProofTimeout()` and `TaskCheckForProofs.getProofs()` | Implemented |
| Add rebroadcast circuit breaker | `MonitorOptions.maxRebroadcastAttempts`, default `0`, enforced in proof timeout flow | Implemented |
| Avoid restoring inputs while a live request can still reconcile | `src/storage/methods/reviewStatus.ts` blocks restoration unless matching requests are terminal failure states | Implemented |
| Unit tests for rebroadcast path | `test/storage/EntityProvenTxReq.rebroadcast.test.ts`, `test/monitor/TaskCheckForProofs.rebroadcast.test.ts` | Implemented |
| Adversarial empty-block timeout simulation | `TaskCheckForProofs.rebroadcast.test.ts` covers a request that previously reached `unmined` and times out without proof | Implemented |
| CI-safe testnet load harness gate | `npm run loadtest:testnet` skips unless `TESTNET_LOAD_ENABLED=1` | Implemented |
| Require live testnet credentials | `TestnetThroughput.load.ts` requires `ARC_URL`, `ARC_API_KEY`, and `TESTNET_WALLET_WIF` when enabled | Implemented |
| Use real temp RocksDB store | `TestnetThroughput.load.ts` opens `StorageRocksDb` in an OS temp directory and removes it in `finally` | Implemented |
| Use real testnet services | Harness creates `Services` with `chain='test'`, `ARC_URL`, and `ARC_API_KEY` | Implemented |
| Use wallet-toolbox wallet with RocksDB storage | Harness creates `WalletStorageManager` over `StorageRocksDb` and a `Wallet` | Implemented |
| Import funded testnet UTXOs | Harness discovers P2PKH UTXOs for `TESTNET_WALLET_WIF` or accepts `TESTNET_LOAD_OUTPOINTS` | Implemented |
| Stage 10 tx/s x 10s, 10 tx/s x 60s, 50 tx/s x 10s | Harness stage table matches the source goal ceiling | Implemented |
| Create P2PKH self-send transactions using `createAction` | Harness calls `wallet.createAction()` with a P2PKH self-send output | Implemented |
| Measure TPS and latency percentiles | Harness records attempted/succeeded/failed, actual TPS, p50/p95/p99 latency | Implemented |
| Capture cache, queue, provider, and storage metrics | Harness uses `metricsSnapshot()` and prints full Prometheus text after every stage | Implemented |
| Stop cleanly on rate limits or UTXO exhaustion | Harness classifies provider rate limits and UTXO exhaustion, stops the ladder, and cleans up | Implemented |
| Distributed message backbone | `nats` dependency, `NatsManager`, message contracts, stream configs, durable consumer defaults, and Redis/BullMQ dependency guard are present | Implemented |
| Distributed broadcast pipeline | `BroadcastPublisher`, JetStream-aware `BroadcastConsumer`, and `TaskSendWaiting` publisher path are present; raw transaction bytes are not published in `TxBroadcastMessage` | Implemented |
| Distributed cache invalidation | `CacheInvalidationPublisher` dual-publishes local/NATS invalidations and `CacheInvalidationConsumer` applies block/UTXO/reorg invalidation | Implemented |
| Proof request wake-up pipeline | `ProofRequestPublisher`, `ProofRequestConsumer`, and `BlockEventConsumer` provide the distributed proof-request interfaces | Implemented |
| Transaction tail instrumentation | `StorageRocksDb.transaction()` records `transactionTail.wait` and `transactionTail.run` through the RocksDB metrics hook when configured | Implemented |
| Provider capacity and scale ladder docs | `docs/provider-capacity.md` and `docs/scale-ladder-roadmap.md` exist | Implemented |
| Runtime dependency policy | `nats` is allowed for JetStream; Redis and BullMQ remain blocked; `npm run depcheck` passes with 0 errors | Verified |
| Update practical test docs | `docs/practical-testing-plan.md` documents prerequisites, run command, ladder, and bottleneck triage | Implemented |
| Update implementation audit row | `docs/refactor-rocksdb-implementation-audit.md` now describes the package-local live harness | Implemented |
| Execute staged live testnet validation | Environment has `TESTNET_LOAD_ENABLED`, `ARC_URL`, `ARC_API_KEY`, `TESTNET_WALLET_WIF`, and `TESTNET_LOAD_OUTPOINTS` unset | Blocked |
| Optimize based on live bottleneck results | Requires live testnet bottleneck evidence first | Blocked |
| Nektar runtime adapter and JetStream deployment | Source doc states this belongs in a separate Nektar repository, not wallet-toolbox | External |
| Production 1000 tx/s validation | Requires funded 1000 tx/s testnet run and operational Nektar/runtime evidence | Blocked |

## Verification Run

- `npm test`: 87 suites passed, 635 tests passed, 10 skipped.
- `npm run loadtest:testnet`: skipped cleanly with live env unset.
- `npm run loadtest:single-instance`: passed 1000 mocked calls with peak concurrency 100.
- `npm run benchmark:rocksdb-indexes`: passed; 1000 outputs, query timings recorded.
- `npm run depcheck`: 0 errors, 15 existing circular-dependency warnings.
- `git diff --check`: passed.
