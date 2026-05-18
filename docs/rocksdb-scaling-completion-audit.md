# RocksDB Scaling Completion Audit

Generated: 2026-05-18T15:37:41Z

Source objective: implement `docs/rocksdb_scaling.md` end to end.

## Success Criteria

The source plan is complete only when every phase 0-12 deliverable exists,
required tests pass, live testnet Stage 3 reaches `50tps-10s` cleanly, live
JetStream distributed acceptance passes, and the final artifact can truthfully
set `ok:true`.

That state is not reached in this environment because live testnet credentials
and a live NATS JetStream server are not configured.

## Checklist

| Requirement | Evidence | Status |
|---|---|---|
| Phase 0 inventory `.tmp/distributed-scale-refactor/inventory.json` | `.tmp/distributed-scale-refactor/inventory.json` | Implemented |
| Phase 1 complete `reviewStatusIdb.ts` steps 2 and 3 | `src/storage/methods/reviewStatusIdb.ts`; `test/storage/reviewStatusRocksDb.test.ts`; `test/monitor/BroadcastRecovery.integration.test.ts` | Implemented |
| Phase 2 exact integration test file | `test/monitor/BroadcastRecovery.integration.test.ts` | Implemented |
| Scenario 3b broadcast timeout rebroadcasts without input restoration | `BroadcastRecovery.integration.test.ts` scenario 3b | Implemented |
| Scenario 8 live mempool request blocks input restoration | `BroadcastRecovery.integration.test.ts` scenario 8; `reviewStatusRocksDb.test.ts` | Implemented |
| Scenario 9 circuit breaker invalidates then permits terminal restoration | `BroadcastRecovery.integration.test.ts` scenario 9 | Implemented |
| Scenario 10 proof threshold respects `wasBroadcast` | `BroadcastRecovery.integration.test.ts` scenario 10 | Implemented |
| Scenario 11 never-broadcast invalid tx restores inputs | `BroadcastRecovery.integration.test.ts` scenario 11 | Implemented |
| Phase 3 add NATS dependency | `package.json` has `nats`; `package-lock.json` resolved | Implemented |
| Phase 3 `NatsManager` | `src/messaging/NatsManager.ts`; `test/messaging/NatsManager.test.ts` | Implemented |
| Phase 3 message contracts | `src/messaging/messages.ts` | Implemented |
| Phase 3 stream definitions and consumer defaults | `NATS_STREAM_DEFINITIONS`; `NATS_CONSUMER_DEFAULTS`; dedicated `DEAD_LETTER` stream for poison/max-deliver routing | Implemented |
| Phase 4 `BroadcastPublisher` | `src/messaging/publishers/BroadcastPublisher.ts`; `test/messaging/BroadcastPublisher.test.ts` | Implemented |
| Phase 4 JetStream-aware `BroadcastConsumer` | `src/messaging/consumers/BroadcastConsumer.ts`; `test/messaging/BroadcastConsumer.jetstream.test.ts` | Implemented |
| Phase 4 durable TX_BROADCAST pull worker | `src/messaging/consumers/NatsBroadcastWorker.ts`; `test/messaging/NatsBroadcastWorker.test.ts` | Implemented |
| Phase 4 RocksDB broadcast loader/recorder | `src/storage/BroadcastStorageAdapter.ts`; `test/messaging/BroadcastStorageAdapter.test.ts` | Implemented |
| Phase 4 `TaskSendWaiting` distributed path | `src/monitor/tasks/TaskSendWaiting.ts`; `BroadcastRecovery.integration.test.ts` | Implemented |
| Phase 4 dependency guard | `test/guards/NoBannedDependencies.test.ts`; updated dependency policy | Implemented |
| Phase 5 dual cache invalidation publisher | `src/messaging/publishers/CacheInvalidationPublisher.ts`; tests | Implemented |
| Phase 5 cache invalidation consumer | `src/messaging/consumers/CacheInvalidationConsumer.ts`; tests | Implemented |
| Phase 5 cache-not-authority invariant | `test/cache/CacheNotAuthority.test.ts`; `Services.isUtxo()` bypasses cache | Implemented |
| Phase 6 prefix indexes | `src/storage/rocksdb/RocksDbWalletStore.ts`; `npm run benchmark:rocksdb-indexes` | Verified |
| Phase 6 atomic secondary index maintenance | `RocksDbWalletStore` output index updates; existing storage tests | Verified |
| Phase 6 safe RocksDB config handling | `RocksDbWalletStoreOptions` and unsupported-option guard | Implemented |
| Phase 6 transaction tail instrumentation | `src/storage/StorageRocksDb.ts`; `test/storage/StorageRocksDb.test.ts` | Implemented |
| Phase 7 proof request publisher | `src/messaging/publishers/ProofRequestPublisher.ts`; `test/messaging/ProofRequestPipeline.test.ts` | Implemented |
| Phase 7 proof request consumer | `src/messaging/consumers/ProofRequestConsumer.ts`; tests | Implemented |
| Phase 7 block events wake proof requests | `src/messaging/consumers/BlockEventConsumer.ts`; tests | Implemented |
| Phase 8 real-network harness | `test/performance/TestnetThroughput.load.ts`; script `loadtest:testnet` | Implemented |
| Phase 8 throughput safety artifact | `.tmp/wallet-toolbox-throughput-safety/latest.json` | Implemented; skipped |
| Phase 9 provider capacity doc | `docs/provider-capacity.md` | Implemented |
| Phase 10 live staged testnet validation | Requires live `TESTNET_LOAD_ENABLED=1`, `ARC_URL`, `ARC_API_KEY`, funded `TESTNET_WALLET_WIF` | Blocked |
| Phase 11 distributed acceptance file | `test/distributed/NatsBroadcastConsumer.integration.test.ts` | Live-gated scenarios implemented; skipped until Stage 3 and `NATS_URL` are present |
| Phase 11 live distributed acceptance artifact | `.tmp/wallet-toolbox-distributed-broadcast/latest.json` | Blocked; artifact records blockers |
| Phase 12 scale ladder roadmap | `docs/scale-ladder-roadmap.md` | Implemented |
| Final artifact | `.tmp/wallet-toolbox-distributed-scale-refactor/latest.json` | Written with `ok:false` and blockers |

## Verification

- `npm test`: 99 suites passed, 672 tests passed, 16 skipped.
- `npx jest test/distributed/NatsBroadcastConsumer.integration.test.ts test/messaging/BroadcastStorageAdapter.test.ts test/messaging/BroadcastConsumer.jetstream.test.ts test/messaging/NatsManager.test.ts --runInBand`: 16 tests passed, 6 live tests skipped.
- `npx jest test/messaging/NatsBroadcastWorker.test.ts test/security/HttpClientPolicy.test.ts --runInBand`: 3 tests passed.
- `npx jest test/monitor/BroadcastRecovery.integration.test.ts --runInBand`: 5 tests passed.
- `npm run depcheck`: 0 errors, 15 existing circular dependency warnings.
- `npm run loadtest:testnet`: skipped because `TESTNET_LOAD_ENABLED` is unset; throughput artifact regenerated at 2026-05-18T15:21:49.266Z.
- `npm run loadtest:single-instance`: 1000 mocked calls, maxActive 100, about 58.7k TPS.
- `npm run benchmark:rocksdb-indexes`: 1000 outputs benchmark passed.
- `git diff --check`: passed.

## Remaining Work

1. Configure live testnet prerequisites: `TESTNET_LOAD_ENABLED=1`, `ARC_URL`,
   `ARC_API_KEY`, funded `TESTNET_WALLET_WIF`, and enough outpoints.
2. Run Stage 1, Stage 2, and Stage 3 exactly as Phase 10 defines.
3. Configure a live NATS JetStream server via `NATS_URL`, initialize streams,
   and run the Phase 11 distributed exactly-once/restart/dead-letter tests.
4. Update both JSON artifacts with real observed counts only after those live
   validations pass.

Until those steps pass, the final `ok:true` artifact required by
`rocksdb_scaling.md` cannot be produced honestly.
