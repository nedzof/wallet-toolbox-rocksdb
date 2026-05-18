Here is the fully standalone `/goal` command — RocksDB only, no IndexedDB references, all context self-contained:



\---



````markdown

/goal — Wallet-Toolbox-RocksDB Distributed Scale End-State Refactor



\## GOAL



Implement the end-state distributed scaling architecture for wallet-toolbox-rocksdb.



Do not fear breaking changes. Remove unsafe legacy behavior. Do not preserve backwards

compatibility if it keeps unclear ownership, unsafe recovery, single-instance bottlenecks,

or fake throughput claims alive.



One mission: make the wallet/payment engine safe first, then distributed, then measurable

under real testnet load.



Target end state:



```text

wallet-toolbox-rocksdb

&#x20; owns wallet state, RocksDB storage, UTXO indexes, basket-local liquidity, signing, rebroadcast-safe tx state



Nektar endurance/runtime

&#x20; owns JetStream distributed work routing, lane workers, broadcast orchestration, proof requests, operator artifacts



NATS JetStream

&#x20; owns distributed command/event streams, worker coordination, durable ACK/NACK/dead-letter behavior



RocksDB

&#x20; owns local durable wallet truth, UTXO state, signing records, tx state, outbox/proof-related indexes



Temporal

&#x20; owns long-running repair/recovery/control-plane workflows later, but not the hot broadcast queue in this goal



No Redis.

No BullMQ.

No fake 1000 tx/s claim.

```



\---



\## CONTEXT — WHAT EXISTS IN THE CODEBASE TODAY



Repository: `nedzof/wallet-toolbox-rocksdb` (branch: main)

Package: `@bsv/wallet-toolbox-rocksdb` version `2.1.25-rocksdb.0`



\### Already Implemented



\*\*RocksDB Storage Layer:\*\*

\- `src/storage/StorageRocksDb.ts` — Full `StorageProvider` implementation using RocksDB.

&#x20; - `transaction<T>()` method serializes ALL writes through a single `transactionTail` promise chain (lines 166-172):

&#x20;   ```typescript

&#x20;   async transaction<T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T> {

&#x20;     if (trx != null) return await scope(trx)

&#x20;     const run = async (): Promise<T> => await scope({} as TrxToken)

&#x20;     const next = this.transactionTail.then(run, run)

&#x20;     this.transactionTail = next.then(() => undefined, () => undefined)

&#x20;     return await next

&#x20;   }

&#x20;   ```

&#x20; - `reviewStatus()` delegates to `reviewStatusIdb()` at line 174-175.

\- `src/storage/rocksdb/RocksDbWalletStore.ts` — Low-level RocksDB binding wrapper.

&#x20; - `parallelismThreads` default = 12

&#x20; - WAL enabled by default (`disableWAL: false`)

&#x20; - Supports: `blockCacheSize`, `compactOnClose`, `enableStats`, `pessimistic` transactions, `readOnly` mode

&#x20; - Metrics hook via `WalletToolboxMetrics.recordStorageQuery`



\*\*Broadcast Recovery Safety (Knex/SQL path only):\*\*

\- `src/monitor/tasks/TaskCheckForProofs.ts` lines 157-176:

&#x20; - When `req.attempts > limit`, calls `req.applyProofTimeout(maxRebroadcast)`.

&#x20; - If action is `'rebroadcast'`: resets to unsent, same txid, same raw hash.

&#x20; - If action is `'invalid'` and `wasBroadcast=true`: marks invalid only after rebroadcast limit exhausted.

&#x20; - If `wasBroadcast=false`: marks invalid immediately (never-broadcast tx).

\- `src/storage/methods/reviewStatus.ts`:

&#x20; - Step 1: Marks transactions `'failed'` if ProvenTxReq is `'invalid'`.

&#x20; - Step 2: Restores inputs ONLY if ALL ProvenTxReqs for that txid are terminal-safe.

&#x20; - Step 3: Marks transactions `'completed'` when matching ProvenTx exists.

&#x20; - Safety constant at line 9: `provenTxReqStatusesSafeForInputRestore = \['invalid', 'doubleSpend']`

&#x20; - Guard logic (lines 69-83): `whereNotExists` subquery blocks restoration if any req status NOT IN `\['invalid', 'doubleSpend']`

\- `src/storage/schema/entities/EntityProvenTx.ts` line 290-295:

&#x20; - Secondary threshold (attempts > limit AND age > minutes) also calls `applyProofTimeout(maxRebroadcastAttempts)`.

\- `src/monitor/Monitor.ts` lines 130-132:

&#x20; - `unprovenAttemptsLimitTest: 100`

&#x20; - `unprovenAttemptsLimitMain: 144`

&#x20; - `maxRebroadcastAttempts: 0` (unlimited by default)

\- `wasBroadcast` and `rebroadcastAttempts` fields persist via `StorageProvider.updateProvenTxReqDynamics`.

\- Unit tests exist: `test/storage/EntityProvenTxReq.rebroadcast.test.ts`



\*\*RocksDB Storage Path — `reviewStatusIdb.ts` (THE INCOMPLETE FILE):\*\*

\- `src/storage/methods/reviewStatusIdb.ts` — this file serves `StorageRocksDb.reviewStatus()`.

&#x20; - Despite its name, this is the RocksDB storage path (StorageRocksDb calls it via `reviewStatusIdb(this as never, args)`).

&#x20; - \*\*Step 1 implemented\*\* (lines 21-34): finds invalid ProvenTxReqs, marks matching transactions `'failed'`.

&#x20; - \*\*Step 2 NOT implemented\*\* (line 37): stub comment only — "sets outputs to spendable true, spentBy undefined if spentBy is a transaction with status 'failed'."

&#x20; - \*\*Step 3 NOT implemented\*\* (line 36): stub comment only — "sets transactions to 'completed' if provenTx with matching txid exists and current provenTxId is null."

&#x20; - Full file content today:

&#x20;   ```typescript

&#x20;   export async function reviewStatusIdb (

&#x20;     storage: StorageIdb,

&#x20;     args: { agedLimit: Date, trx?: sdk.TrxToken }

&#x20;   ): Promise<{ log: string }> {

&#x20;     const r: { log: string } = { log: '' }

&#x20;     // 1. set transactions to 'failed' ...

&#x20;     const invalidTxids: string\[] = \[]

&#x20;     await storage.filterProvenTxReqs({ partial: { status: 'invalid' } }, txReq => {

&#x20;       invalidTxids.push(txReq.txid)

&#x20;     })

&#x20;     for (const txid of invalidTxids) {

&#x20;       const txs = await storage.findTransactions({ partial: { txid } })

&#x20;       for (const tx of txs) {

&#x20;         if (tx.status !== 'failed') {

&#x20;           r.log += `transaction ${tx.transactionId} updated to status of 'failed' was ${tx.status}\\n`

&#x20;           await storage.updateTransactionStatus('failed', tx.transactionId)

&#x20;         }

&#x20;       }

&#x20;     }

&#x20;     // 2. sets transactions to 'completed' if provenTx with matching txid exists and current provenTxId is null.

&#x20;     // 3. sets outputs to spendable true, spentBy undefined if spentBy is a transaction with status 'failed'.

&#x20;     return r

&#x20;   }

&#x20;   ```



\*\*Broadcast Orchestration:\*\*

\- `src/broadcast/BroadcastOrchestrator.ts` — bounded priority queue using `p-queue`, concurrency control.

\- `src/messaging/consumers/BroadcastConsumer.ts` — thin in-process wrapper around BroadcastOrchestrator.

&#x20; - NOT a JetStream consumer. No NATS. Just wraps `orchestrator.broadcast()`.

\- `src/messaging/publishers/CacheInvalidationPublisher.ts` — wraps `EventBus` with named publish methods.

&#x20; - NOT a network publisher. No NATS. Just calls `eventBus.emitBlockMined()`, `emitUtxoInvalidation()`, `emitReorg()`.



\*\*HTTP Provider Pooling:\*\*

\- `src/http/UndiciHttpClient.ts` — SDK `HttpClient` adapter using undici `Pool`.

&#x20; - Per-origin connection pools.

&#x20; - Default: 50 connections, pipelining 10, H2 enabled.

&#x20; - Has `close()`, `download()`, `request()`.

&#x20; - Package dependency: `"undici": "^8.3.0"` (already in package.json).



\*\*Caching:\*\*

\- `src/cache/UtxoCacheManager.ts` — LRU cache for UTXO status results.

&#x20; - Default: max 10,000 entries, TTL 30 seconds.

&#x20; - EventBus-driven invalidation: listens to `BLOCK\_MINED`, `UTXO\_INVALIDATE`, `REORG`.

&#x20; - Full `clear()` on reorg, targeted invalidation on block/outpoint events.

&#x20; - Tracks hits/misses/hitRate for metrics.

&#x20; - `getOrLoad()` coalesces concurrent requests for same key (in-flight dedup).

&#x20; - Cache is read-hint only. Does NOT decide spendability.

\- `src/cache/BlockHeaderCache.ts` — LRU for block headers.

\- `src/cache/ScriptHashCache.ts` — LRU for script hash lookups.



\*\*EventBus:\*\*

\- `src/events/EventBus.ts` — in-process EventEmitter (eventemitter3).

&#x20; - Events: `BLOCK\_MINED`, `UTXO\_INVALIDATE`, `REORG`.

&#x20; - Typed emit/subscribe for each event type.

&#x20; - NOT a network bus. Purely in-process.



\*\*TaskSendWaiting:\*\*

\- `src/monitor/tasks/TaskSendWaiting.ts`:

&#x20; - `triggerMsecs = 1 second`

&#x20; - `chunkLimit = 500`

&#x20; - `processConcurrency = 100`

&#x20; - Fetches `\['unsent', 'sending']` ProvenTxReqs, expands batches, filters by age, processes concurrently.



\*\*Metrics:\*\*

\- `prom-client` (^15.1.3) in dependencies.

\- `WalletToolboxMetrics` referenced throughout for storage queries, cache stats, broadcast.



\*\*Load Testing (mocked only):\*\*

\- `test/performance/SingleInstanceThroughput.load.ts` — mocked BroadcastOrchestrator throughput test.

&#x20; - Uses `setImmediate` as fake I/O. Does NOT prove real-network throughput.

&#x20; - Tests scheduling shape: PQueue concurrency, priority, drain.

&#x20; - npm script: `loadtest:single-instance`

\- `test/performance/RocksDbIndexBenchmark.load.js` — npm script: `benchmark:rocksdb-indexes`



\*\*Current Dependencies (relevant):\*\*

```json

"@harperfast/rocksdb-js": "1.2.0"

"eventemitter3": "^5.0.4"

"lru-cache": "^10.4.3"

"p-limit": "^3.1.0"

"p-queue": "^6.6.2"

"prom-client": "^15.1.3"

"undici": "^8.3.0"

```



No NATS dependency exists today.



\### Known Gaps



```text

1\. reviewStatusIdb.ts Steps 2 and 3 are stub comments — RocksDB wallets cannot restore

&#x20;  inputs for legitimately failed never-broadcast txs, and cannot mark txs completed

&#x20;  when proofs arrive. This is safe by omission but functionally incomplete.



2\. ScenarioBuilder (referenced in TESTING\_PLAN.md) does not exist as test infrastructure.

&#x20;  The adversarial miner rebroadcast integration tests are specifications only.



3\. BroadcastConsumer is in-process only — no JetStream, no durable consumer, no ACK/NACK.



4\. CacheInvalidationPublisher is in-process only — no network transport.



5\. No NatsManager, no JetStream streams, no distributed message backbone.



6\. Real-network throughput harness does not exist. Only mocked setImmediate load test.



7\. Provider capacity artifact does not exist.



8\. StorageRocksDb.transaction() serializes ALL writes through a single promise chain.

&#x20;  Under high concurrent write load this is a scalability ceiling.



9\. No distributed acceptance tests exist.

```



\---



\## CRITICAL SAFETY INVARIANT



```text

A broadcasted transaction can NEVER restore its inputs to spendable unless a terminal,

proof-backed rejection or double-spend state is recorded.

```



This invariant is enforced in the Knex SQL path via reviewStatus.ts.

It is NOT yet enforced in the RocksDB path because reviewStatusIdb.ts Steps 2/3 are unimplemented.

The RocksDB path is currently safe by omission (it never restores inputs at all) but incomplete.



\---



\## HARD RULES



\* Testnet only for live validation.

\* No mainnet.

\* No WP45/live-testnet-circulation-ramp.

\* No production-readiness claim.

\* No 1000 tx/s claim unless the final staged validation actually proves it.

\* No Redis.

\* No BullMQ.

\* No cache-as-authority. Cache is read-hint only. Spend authority = RocksDB wallet storage + fresh provider check.

\* No replacement transaction on retry. Same txid, same signed raw tx only.

\* Rebroadcast must reuse the same signed tx data and same txid.

\* WAL must remain enabled on all RocksDB runtime stores.

\* No rawTxHex in public/operator artifacts.

\* No private keys, WIF, xpriv, seed, mnemonic, raw signing material, provider tokens, BHS tokens, or SPV keys printed or artifacted.

\* Stop immediately if any path would restore inputs for a broadcast-visible tx without terminal proof-backed rejection.

\* Stop immediately if distributed workers can process the same idempotency key into duplicate effects.

\* Stop immediately if a cache can decide spendability.

\* Stop immediately if unknown outcome is blindly retried instead of reconciled.



\---



\# PHASE 0 — ARCHITECTURE MAP BEFORE TOUCHING CODE



Before changing behavior, map the current implementation.



Write:



```text

.tmp/distributed-scale-refactor/inventory.json

```



Required fields:



```text

ok

generatedAt

filesScanned

storagePaths\[]

reviewStatusPaths\[]

broadcastPaths\[]

rebroadcastPaths\[]

cachePaths\[]

eventBusPaths\[]

httpPoolPaths\[]

rocksDbTransactionPaths\[]

taskMonitorPaths\[]

messagingPaths\[]

testHarnessPaths\[]

providerConfigPaths\[]

dangerousPaths\[]

ambiguousPaths\[]

evidenceHash

```



Must locate and record the following files with their current role:



```text

src/storage/StorageRocksDb.ts — RocksDB storage provider, transactionTail serialization

src/storage/rocksdb/RocksDbWalletStore.ts — low-level RocksDB binding wrapper

src/storage/methods/reviewStatusIdb.ts — RocksDB reviewStatus path (INCOMPLETE: only step 1)

src/storage/methods/reviewStatus.ts — Knex/SQL reviewStatus path (COMPLETE with safety guard)

src/storage/StorageProvider.ts — base class, updateTransactionStatus, updateOutput

src/monitor/tasks/TaskCheckForProofs.ts — proof timeout handling, rebroadcast wiring

src/monitor/tasks/TaskSendWaiting.ts — unsent req processing, 1s trigger, 500 chunk, 100 concurrency

src/monitor/Monitor.ts — monitor options, attempt limits, maxRebroadcastAttempts

src/storage/schema/entities/EntityProvenTx.ts — secondary proof threshold, fromReq

src/storage/schema/entities/EntityProvenTxReq.ts — applyProofTimeout, wasBroadcast, rebroadcastAttempts

src/broadcast/BroadcastOrchestrator.ts — PQueue-based broadcast with priority/concurrency

src/messaging/consumers/BroadcastConsumer.ts — in-process wrapper (NOT JetStream)

src/messaging/publishers/CacheInvalidationPublisher.ts — in-process EventBus wrapper (NOT network)

src/http/UndiciHttpClient.ts — undici Pool per origin, 50 connections, pipelining 10

src/cache/UtxoCacheManager.ts — LRU 10K, TTL 30s, EventBus invalidation

src/cache/BlockHeaderCache.ts — LRU block header cache

src/cache/ScriptHashCache.ts — LRU script hash cache

src/events/EventBus.ts — eventemitter3, BLOCK\_MINED/UTXO\_INVALIDATE/REORG

test/performance/SingleInstanceThroughput.load.ts — mocked load test (proves scheduling only)

test/storage/EntityProvenTxReq.rebroadcast.test.ts — unit tests for applyProofTimeout

```



Do not change code until this inventory exists.



\---



\# PHASE 1 — COMPLETE MONEY SAFETY IN ROCKSDB STORAGE PATH



\## M1.1 Complete `reviewStatusIdb.ts` Steps 2 and 3



File:



```text

src/storage/methods/reviewStatusIdb.ts

```



This file is called by `StorageRocksDb.reviewStatus()`. Despite its name containing "Idb",

this IS the RocksDB storage path. `StorageRocksDb` calls it at line 175:

```typescript

async reviewStatus (args: { agedLimit: Date, trx?: TrxToken }): Promise<{ log: string }> {

&#x20; return await reviewStatusIdb(this as never, args)

}

```



Current state:



```text

Step 1 implemented: marks transactions failed from invalid ProvenTxReqs ✓

Step 2 NOT implemented: stub comment at line 37

Step 3 NOT implemented: stub comment at line 36

```



IMPORTANT — step ordering mismatch:



The file's docstring describes the order as:

```text

1\. mark failed

2\. mark completed

3\. restore inputs

```



The Knex `reviewStatus.ts` implementation executes in this order:

```text

1\. mark failed

2\. restore inputs (with safety guard)

3\. mark completed

```



Follow the Knex execution order for safety-first semantics. Restore inputs BEFORE

marking completed, so that a completed transaction cannot accidentally have its

inputs restored.



Implement Step 2 (input restoration with safety guard):



```text

Find all outputs where spentBy references a transaction with status='failed'.

For each such output:

&#x20; - Find all ProvenTxReq records matching the transaction's txid.

&#x20; - If NO ProvenTxReq records exist for that txid: restore inputs (never had a req).

&#x20; - If ALL ProvenTxReq records for that txid have status IN \['invalid', 'doubleSpend']:

&#x20;   restore inputs (all are terminal-safe).

&#x20; - If ANY ProvenTxReq for that txid has a status NOT IN \['invalid', 'doubleSpend']:

&#x20;   DO NOT restore inputs (tx may still be live/reconcilable).

```



Terminal-safe statuses (must exactly match Knex path constant):



```typescript

const provenTxReqStatusesSafeForInputRestore: ProvenTxReqStatus\[] = \['invalid', 'doubleSpend']

```



Extract this constant to a shared location importable by both `reviewStatus.ts` and

`reviewStatusIdb.ts`, OR deliberately duplicate it with a comment pointing to the

canonical definition at `src/storage/methods/reviewStatus.ts` line 9.



Do NOT restore inputs for txids with ANY ProvenTxReq in states including but not limited to:



```text

unmined, callback, unconfirmed, sending, unsent, unknown, nonfinal,

unprocessed, nosend, completed, unfail

```



Restore action:



```typescript

await storage.updateOutput(output.outputId, { spendable: true, spentBy: undefined })

```



Use the storage methods available on the `StorageIdb`/`StorageRocksDb` interface:

\- `storage.findTransactions({ partial: { status: 'failed' } })`

\- `storage.findOutputs(...)` with filter for spentBy matching failed transaction

\- `storage.findProvenTxReqs({ partial: { txid } })`

\- `storage.updateOutput(outputId, { spendable: true, spentBy: undefined })`



Implement Step 3 (completed marking):



```text

Find all transactions where provenTxId is null or undefined.

For each such transaction:

&#x20; - Look up ProvenTx records matching that txid.

&#x20; - If a ProvenTx exists: update transaction to status='completed' and set provenTxId.

```



Use:

\- `storage.findTransactions({ partial: {} })` filtered for null provenTxId

\- `storage.findProvenTxs({ partial: { txid } })`

\- `storage.updateTransaction(transactionId, { status: 'completed', provenTxId })`



Log all changes to `r.log` with descriptive messages matching the Knex path style.



Acceptance:



```text

✓ Broadcast-visible tx inputs never restored (any non-terminal req blocks it)

✓ Never-broadcast failed tx inputs restore when ALL reqs are terminal-safe

✓ Transactions marked completed when matching ProvenTx exists

✓ Knex SQL path behavior not regressed

✓ npm test passes

✓ npm run build passes

```



\---



\# PHASE 2 — MAKE BROADCAST RECOVERY TESTS REAL



\## M2.1 Create test infrastructure



```text

ScenarioBuilder currently exists only as specification language in TESTING\_PLAN.md.

It is NOT real test infrastructure. No ScenarioBuilder class exists in the codebase.

Create ScenarioBuilder or implement equivalent fixture/mock approach.

```



Reference the existing test pattern:

\- `test/storage/EntityProvenTxReq.rebroadcast.test.ts` — creates mock req objects, calls `applyProofTimeout`, asserts state changes.



Create:



```text

test/monitor/BroadcastRecovery.integration.test.ts

```



The tests must exercise:

\- The RocksDB storage path (`StorageRocksDb` with `reviewStatusIdb`)

\- The monitor task path (`TaskCheckForProofs` calling `applyProofTimeout`)

\- End-to-end state transitions through the full lifecycle



\## M2.2 Implement required scenarios as passing tests



\### Scenario 3b — Adversarial Miner Rebroadcast Path



Setup:

```text

\- Create ProvenTxReq with status='unmined', wasBroadcast=true

\- Simulate proof-check cycles where no proof is found

\- After attempts > unprovenAttemptsLimitTest (100), applyProofTimeout fires

```



Expected behavior:

```text

\- applyProofTimeout returns { action: 'rebroadcast', rebroadcastAttempts: 1 }

\- req.status becomes 'unsent'

\- req.attempts becomes 0

\- req.wasBroadcast remains true

\- req.rebroadcastAttempts increments

\- Same txid preserved (never generates replacement tx)

\- TaskSendWaiting picks up 'unsent' req and rebroadcasts

\- Eventually tx is mined → proof found → req status='completed'

\- Inputs NEVER restored to spendable during entire lifecycle

```



\### Scenario 8 — reviewStatus Does Not Restore Inputs for Live Mempool Txs



Setup:

```text

\- Transaction status='failed'

\- ProvenTxReq for same txid has status='unmined' (or 'sending', 'unsent', 'callback', etc.)

```



Test both paths:

```text

\- Run reviewStatus (Knex path) → inputs remain locked

\- Run reviewStatusIdb (RocksDB path) → inputs remain locked

```



Expected:

```text

\- Output.spendable remains false

\- Output.spentBy remains set

\- No input restoration occurs

```



\### Scenario 9 — Circuit Breaker After maxRebroadcastAttempts



Setup:

```text

\- Configure maxRebroadcastAttempts = 2

\- ProvenTxReq with wasBroadcast=true, rebroadcastAttempts approaching limit

```



Expected:

```text

\- First timeout: rebroadcast (cycle 1)

\- Second timeout: rebroadcast (cycle 2)

\- Third timeout: action='invalid', rebroadcastAttempts=2, status='invalid'

\- No replacement tx generated

\- After invalidation, reviewStatus CAN restore inputs (req is now terminal-safe)

```



\### Scenario 10 — EntityProvenTx.fromReq Secondary Threshold Respects wasBroadcast



Setup:

```text

\- req.attempts > EntityProvenTx.getProofAttemptsLimit

\- ageInMinutes > EntityProvenTx.getProofMinutes

```



Test wasBroadcast=true:

```text

\- applyProofTimeout triggers rebroadcast behavior

\- Does NOT mark invalid on first occurrence

```



Test wasBroadcast=false:

```text

\- applyProofTimeout marks invalid immediately

\- Normal never-broadcast failure semantics preserved

```



\### Scenario 11 — Never-Broadcast Txs Still Get Inputs Restored



Setup:

```text

\- ProvenTxReq never reached 'unmined'/'callback'/'unconfirmed' status

\- wasBroadcast=false

\- req marked invalid after proof timeout

```



Expected:

```text

\- reviewStatusIdb (RocksDB path): inputs restored to spendable

\- This is correct and expected behavior for txs that never left the wallet

```



\### Additional Tests:



```text

\- reviewStatusIdb Step 2 directly: terminal-safe restoration works

\- reviewStatusIdb Step 3 directly: completed marking works when ProvenTx exists

\- Cache is not used as spend authority anywhere in test paths

\- No rawTxHex or secrets written to test artifacts

```



Acceptance:



```text

✓ All new tests pass

✓ npm test passes (all existing + new)

✓ npm run build passes

✓ Broadcast tx timeout never restores inputs

✓ Never-broadcast terminal failure correctly restores inputs

✓ Same txid reused for every rebroadcast cycle

```



\---



\# PHASE 3 — ESTABLISH DISTRIBUTED MESSAGE BACKBONE



\## M3.1 Add NATS JetStream dependency



Add to package.json dependencies:



```json

{

&#x20; "nats": "^2.28.0"

}

```



Do NOT add:



```text

redis

ioredis

bullmq

temporal (not in this goal)

```



\## M3.2 Create NatsManager



Create:



```text

src/messaging/NatsManager.ts

```



Responsibilities:



```text

\- Connect to NATS server (URL from config/env, default: nats://localhost:4222)

\- Create JetStream streams idempotently (jsm.streams.add with update semantics)

\- Publish messages with Nats-Msg-Id header as idempotency/deduplication key

\- Create durable pull consumers with configurable ack policy

\- ACK helper: ack after durable storage write succeeds

\- NACK helper: nack on retryable internal failure

\- Dead-letter routing: messages exceeding max\_deliver route to DL subject

\- Graceful close/drain

\- Health check method (connection status)

\- Configurable TLS and auth credentials from env/config

```



Streams to create:



| Stream | Subjects | Retention | Storage | Max Age | Max Bytes | Duplicate Window |

|--------|----------|-----------|---------|---------|-----------|-----------------|

| `TX\_BROADCAST` | `tx.broadcast.>` | limits | file | 7d | 10GB | 2m |

| `UTXO\_STATUS` | `utxo.status.>`, `utxo.invalidate.>` | limits | file | 24h | 5GB | 2m |

| `BLOCK\_EVENTS` | `block.>` | limits | file | 30d | 10GB | 2m |

| `PROOF\_REQUESTS` | `proof.request.>`, `proof.result.>` | limits | file | 7d | 10GB | 2m |

| `CACHE\_INVALIDATE` | `cache.invalidate.>` | limits | file | 1h | 1GB | 30s |



Default local/dev mode: replicas=1.

Production config must allow: replicas=3, TLS, auth credentials.



\## M3.3 Add distributed message types



Create:



```text

src/messaging/messages.ts

```



Every message type must include:



```typescript

interface BaseMessage {

&#x20; messageId: string

&#x20; idempotencyKey: string

&#x20; createdAtMs: number

&#x20; schemaVersion: number

&#x20; source: string

&#x20; chain: 'test' | 'main'

}

```



Message types:



```typescript

interface TxBroadcastMessage extends BaseMessage {

&#x20; txid: string

&#x20; rawTxHash: string // hash of raw tx bytes — NOT the raw bytes themselves

&#x20; providerPolicyRef?: string

&#x20; attempt: number

&#x20; priority: number

&#x20; walletStorageIdentityKey: string

&#x20; provenTxReqId: number

}



interface UtxoStatusMessage extends BaseMessage {

&#x20; outpoints: string\[]

&#x20; blockHeight?: number

&#x20; isUtxo?: boolean

&#x20; source: string

&#x20; observedAt: string

}



interface BlockEventMessage extends BaseMessage {

&#x20; type: 'mined' | 'reorg'

&#x20; blockHeight: number

&#x20; blockHash?: string

&#x20; outpoints?: string\[]

&#x20; reorgDepth?: number

}



interface ProofRequestMessage extends BaseMessage {

&#x20; provenTxReqId: number

&#x20; txid: string

&#x20; walletStorageIdentityKey: string

&#x20; requestedAt: string

}



interface ProofResultMessage extends BaseMessage {

&#x20; provenTxReqId: number

&#x20; txid: string

&#x20; status: 'completed' | 'unmined' | 'unknown' | 'doubleSpend' | 'invalidTx'

&#x20; blockHeight?: number

&#x20; merklePath?: string

&#x20; providerAttempts: string\[]

&#x20; observedAt: string

}



interface CacheInvalidationMessage extends BaseMessage {

&#x20; type: 'block' | 'utxo' | 'reorg'

&#x20; outpoints?: string\[]

&#x20; blockHeight?: number

&#x20; reorgDepth?: number

}

```



SECURITY RULE: `TxBroadcastMessage` must NOT include raw transaction bytes.

Broadcast workers must read raw tx from RocksDB wallet storage by txid/provenTxReqId

through a private internal interface. Raw tx bytes never travel through public/operator

message streams.



\## M3.4 Consumer settings (defaults)



| Stream | Durable Group | Ack Policy | Max Deliver | Ack Wait | Max Ack Pending |

|--------|--------------|-----------|-------------|----------|-----------------|

| `TX\_BROADCAST` | `broadcast-workers` | explicit | 3 | 30s | 500 |

| `UTXO\_STATUS` | `utxo-cache-workers` | explicit | 3 | 15s | 1000 |

| `BLOCK\_EVENTS` | `block-event-workers` | explicit | 5 | 30s | 1000 |

| `PROOF\_REQUESTS` | `proof-workers` | explicit | 5 | 60s | 500 |

| `CACHE\_INVALIDATE` | `cache-workers` | explicit | 3 | 10s | 1000 |



\---



\# PHASE 4 — DISTRIBUTED BROADCAST PIPELINE



\## M4.1 Create BroadcastPublisher



Create:



```text

src/messaging/publishers/BroadcastPublisher.ts

```



Responsibilities:



```text

\- Accept signed tx reference (txid, provenTxReqId, priority, attempt count)

\- Generate idempotencyKey: `${chain}:${walletStorageIdentityKey}:broadcast:${provenTxReqId}:${txid}:${attempt}`

\- Publish TxBroadcastMessage to TX\_BROADCAST stream via NatsManager

\- Use idempotencyKey as Nats-Msg-Id header (JetStream deduplication)

\- Do NOT publish duplicate if within duplicate\_window

\- Return publish acknowledgement or throw on failure

```



\## M4.2 Upgrade BroadcastConsumer to JetStream



File:



```text

src/messaging/consumers/BroadcastConsumer.ts

```



Current state: thin in-process wrapper around BroadcastOrchestrator.



Upgrade to:



```text

\- Subscribe to TX\_BROADCAST stream via NatsManager durable pull consumer

\- On message received:

&#x20; 1. Parse TxBroadcastMessage

&#x20; 2. Validate schema (reject malformed → dead-letter)

&#x20; 3. Load signed raw tx bytes from RocksDB storage by provenTxReqId (private read)

&#x20; 4. Submit SAME transaction to provider pool via BroadcastOrchestrator

&#x20; 5. Classify provider response

&#x20; 6. Record attempt in RocksDB storage (provenTxReq update)

&#x20; 7. ACK only AFTER durable attempt record written to RocksDB

&#x20; 8. NACK on retryable internal failure (RocksDB write error, transient network)

&#x20; 9. Dead-letter on poison/malformed messages

```



Provider response classification:



```text

seen — provider acknowledged tx exists in mempool

already\_seen — provider says already known (success, not duplicate broadcast)

accepted — provider accepted for relay

rejected\_terminal — provider permanently rejects (invalid script, double-spend proof)

rejected\_retryable — provider temporarily rejects (mempool full, rate limit)

rate\_limited — HTTP 429 or explicit rate limit response

timeout — no response within deadline

unknown — ambiguous response that cannot be classified

malformed — response format unrecognizable

```



Rules:



```text

\- Same txid only on every retry

\- Same raw tx bytes only (loaded from RocksDB, never modified)

\- No replacement transaction ever generated

\- unknown → mark outcome 'unknown' on provenTxReq, set reconciliation\_required flag

\- unknown does NOT trigger blind rebroadcast

\- terminal reject → record explicit rejection, allow reviewStatus input restoration path

\- rate\_limited → NACK with backoff delay

```



\## M4.3 Integrate TaskSendWaiting with JetStream



File:



```text

src/monitor/tasks/TaskSendWaiting.ts

```



Change behavior:



```text

\- When NatsManager is configured and connected:

&#x20; Instead of directly calling attemptToPostReqsToNetwork, publish TxBroadcastMessage

&#x20; to TX\_BROADCAST stream via BroadcastPublisher.

&#x20; 

\- When NatsManager is NOT configured (local/single-instance mode):

&#x20; Preserve current behavior — direct in-process broadcast via BroadcastOrchestrator.

&#x20; This keeps single-instance deployments working without NATS.

```



Environment gate:



```text

NATS\_URL environment variable present → use JetStream path

NATS\_URL absent → use local in-process fallback

```



Task settings remain:



```text

triggerMsecs: 1 second

chunkLimit: 500

processConcurrency: 100

```



\## M4.4 Add dependency guard



Create:



```text

test/guards/NoBannedDependencies.test.ts

```



Test:



```typescript

import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

const banned = \['redis', 'ioredis', 'bullmq', 'bull']

for (const dep of banned) {

&#x20; expect(pkg.dependencies?.\[dep]).toBeUndefined()

&#x20; expect(pkg.devDependencies?.\[dep]).toBeUndefined()

}

```



\---



\# PHASE 5 — CACHE INVALIDATION VIA JETSTREAM



\## M5.1 Upgrade CacheInvalidationPublisher to JetStream



File:



```text

src/messaging/publishers/CacheInvalidationPublisher.ts

```



Current state: wraps in-process EventBus only.



Upgrade to dual-mode:



```text

\- Always emit to local EventBus (existing behavior preserved for in-process caches)

\- When NatsManager is configured: ALSO publish CacheInvalidationMessage to CACHE\_INVALIDATE stream

\- When NatsManager is NOT configured: local EventBus only (current behavior)

```



This means distributed instances all receive cache invalidation events, not just the

local process.



\## M5.2 Create CacheInvalidationConsumer



Create:



```text

src/messaging/consumers/CacheInvalidationConsumer.ts

```



Responsibilities:



```text

\- Subscribe to CACHE\_INVALIDATE stream via NatsManager durable consumer

\- On message:

&#x20; - type='block': call UtxoCacheManager.invalidateByBlock(blockHeight, outpoints)

&#x20; - type='utxo': call UtxoCacheManager.invalidateOutpoints(outpoints)

&#x20; - type='reorg': call UtxoCacheManager.clear()

\- ACK after invalidation applied

\- Do NOT use cache results to decide spendability

```



\## M5.3 Confirm cache-not-authority invariant



Create:



```text

test/cache/CacheNotAuthority.test.ts

```



Tests must prove:



```text

\- UtxoCacheManager.getOrLoad() result is never used to set output.spendable

\- UtxoCacheManager.getUtxoStatus() result is never used to set output.spendable

\- Cache miss falls through to provider/storage check

\- Cache hit is used only as advisory/hint, never as write authority

\- After cache.clear(), operations continue with fresh provider lookups

```



\---



\# PHASE 6 — ROCKSDB STORAGE OPTIMIZATION



\## M6.1 Verify prefix indexes exist



File:



```text

src/storage/rocksdb/RocksDbWalletStore.ts

```



Ensure prefix-scan indexes exist for:



```text

output by outputId

output by scriptHash

output by basket

output by spendable/user

output by status

provenTxReq by txid

provenTxReq by status

provenTx by txid

transaction by txid

transaction by status

broadcast attempt by txid (if attempt records exist)

```



All lookups that currently iterate full collections must use prefix scans instead.



\## M6.2 Maintain secondary indexes atomically



When output/transaction/provenTxReq status changes:



```text

\- Delete old index entry

\- Write new index entry

\- Write primary record

\- All in same RocksDB WriteBatch (atomic)

```



This prevents index inconsistency on crash.



\## M6.3 Tune RocksDB configuration safely



Verify/set defaults:



```text

parallelismThreads: 12 (existing)

WAL: enabled (disableWAL: false) — NEVER disable for runtime stores

blockCacheSize: configurable, suggest 128MB minimum for throughput workloads

compactOnClose: true for clean shutdown

```



Do NOT disable WAL. Crash safety depends on it.



\## M6.4 Instrument transactionTail bottleneck



File:



```text

src/storage/StorageRocksDb.ts

```



Current code (lines 166-172):



```typescript

async transaction<T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T> {

&#x20; if (trx != null) return await scope(trx)

&#x20; const run = async (): Promise<T> => await scope({} as TrxToken)

&#x20; const next = this.transactionTail.then(run, run)

&#x20; this.transactionTail = next.then(() => undefined, () => undefined)

&#x20; return await next

}

```



This serializes ALL storage writes through a single promise chain. Under concurrent

broadcast/proof/cache operations this becomes a throughput ceiling.



Do NOT blindly rewrite it in this phase.



Instead:



```text

1\. Add instrumentation:

&#x20;  - transactionTail queue depth gauge (how many pending)

&#x20;  - transaction execution latency histogram (time from enqueue to completion)

&#x20;  - transaction scope duration histogram (time inside scope function)

2\. Add these metrics to WalletToolboxMetrics

3\. The real-network harness (Phase 8) will expose whether this is the actual bottleneck

4\. Only after measurement proves contention: consider replacing with RocksDB native

&#x20;  optimistic transactions or key-scoped write locks

```



If measurement proves this IS the bottleneck (Phase 8 identifies it):



```text

Option A: Use RocksDB native transactions (if @harperfast/rocksdb-js exposes them)

&#x20; - OptimisticTransactionDB for multi-key atomicity

&#x20; - Concurrent writers with conflict detection

&#x20; - Retry on write conflict



Option B: Key-scoped locking

&#x20; - Map<prefix, Promise> for write serialization per logical entity

&#x20; - Concurrent writes to different entities

&#x20; - Serialized writes to same entity only



Option C: WriteBatch grouping

&#x20; - Collect all writes from a logical transaction into a single WriteBatch

&#x20; - Submit batch atomically

&#x20; - Reduces syscall overhead

```



Do NOT implement Option A/B/C until Phase 8 results prove transactionTail is the bottleneck.



\---



\# PHASE 7 — PROOF REQUEST PIPELINE



\## M7.1 Create ProofRequestPublisher



Create:



```text

src/messaging/publishers/ProofRequestPublisher.ts

```



Responsibilities:



```text

\- After successful broadcast confirmation (status=unmined), publish ProofRequestMessage

\- idempotencyKey: `${chain}:${walletStorageIdentityKey}:proof:${provenTxReqId}:${txid}`

\- Published to PROOF\_REQUESTS stream subject: proof.request.${chain}

```



\## M7.2 Create ProofRequestConsumer



Create:



```text

src/messaging/consumers/ProofRequestConsumer.ts

```



Responsibilities:



```text

\- Subscribe to PROOF\_REQUESTS stream via durable consumer

\- On message:

&#x20; 1. Query provider(s) for merkle proof / tx status

&#x20; 2. If proof found: update provenTxReq status, create ProvenTx record

&#x20; 3. If not found: record attempt, leave for next block event

&#x20; 4. If double-spend detected: update provenTxReq to 'doubleSpend'

&#x20; 5. ACK after storage update

&#x20; 6. NACK on transient failure (provider timeout)

```



\## M7.3 Wire block events to proof wake-up



When BLOCK\_EVENTS consumer receives a new block:



```text

\- Query pending ProvenTxReqs with status='unmined'

\- For each, publish ProofRequestMessage to re-check proof availability

\- This replaces the in-process TaskCheckForProofs polling for distributed mode

```



In local/single-instance mode (no NATS): TaskCheckForProofs continues operating as-is.



\---



\# PHASE 8 — REAL-NETWORK LOAD HARNESS



Create:



```text

test/performance/TestnetThroughput.load.ts

```



Add npm script:



```json

"loadtest:testnet": "npm run build \&\& node out/test/performance/TestnetThroughput.load.js"

```



Requirements:



```text

\- Gated by TESTNET\_LOAD\_ENABLED=1 environment variable

\- If not set: print "Skipping testnet load test (TESTNET\_LOAD\_ENABLED not set)" and exit 0

\- Open real RocksDB store in a temporary directory (mkdtemp)

\- Use real Services with chain='test'

\- Use real provider endpoints from env:

&#x20; - ARC\_URL (required when enabled)

&#x20; - ARC\_API\_KEY (required when enabled)

&#x20; - WHATS\_ON\_CHAIN\_URL (optional)

&#x20; - TESTNET\_WALLET\_WIF (required — funded testnet wallet key)

\- Use real Wallet construction with StorageRocksDb

\- If NATS\_URL is set: use JetStream broadcast path (distributed mode)

\- If NATS\_URL is not set: use local in-process fallback

\- No mocked setImmediate fake I/O

\- No mainnet

\- Clean up temp RocksDB directory on exit (finally block, regardless of pass/fail)

```



Stages (stop at 50 TPS in this goal):



```text

Stage 1: 10 TPS × 10 seconds (100 transactions)

Stage 2: 10 TPS × 60 seconds (600 transactions)

Stage 3: 50 TPS × 10 seconds (500 transactions)

```



Metrics to measure per stage:



```text

actualTps — sustained throughput (total tx / elapsed seconds)

p50LatencyMs — createAction call latency percentiles

p95LatencyMs

p99LatencyMs

cacheHitRate — UtxoCacheManager.getStats().hitRate

broadcastQueueDepth — BroadcastOrchestrator.size + .pending

jetStreamBacklog — pending messages in TX\_BROADCAST consumer (if distributed)

rocksDbWriteLatencyP50Ms — from WalletToolboxMetrics storage query histogram

rocksDbWriteLatencyP95Ms

rocksDbWriteLatencyP99Ms

transactionTailQueueDepthMax — peak pending in transactionTail chain

providerClassifications — { seen, accepted, rejected, unknown, timeout, rateLimited }

failedBroadcasts — total failed

unknownOutcomes — total ambiguous

inputRestorationForBroadcastTxs — count (MUST be 0)

duplicateSpendAttempts — count (MUST be 0)

sameTxidReuseVerified — boolean

```



Print structured bottleneck classification:



```text

category: one of

&#x20; 'provider\_latency'

&#x20; 'provider\_rate\_limit'

&#x20; 'rocksdb\_write\_serialization'

&#x20; 'transaction\_tail\_contention'

&#x20; 'cache\_miss\_rate'

&#x20; 'queue\_backlog\_growth'

&#x20; 'tx\_construction\_cpu'

&#x20; 'proof\_finality\_lag'

&#x20; 'jetstream\_backlog'

&#x20; 'utxo\_exhaustion'

&#x20; 'funding\_exhaustion'



evidence: { metric\_name: value } supporting the classification

```



Write results:



```text

.tmp/wallet-toolbox-throughput-safety/latest.json

```



Required artifact fields:



```json

{

&#x20; "ok": true,

&#x20; "scope": "wallet-toolbox-throughput-safety",

&#x20; "generatedAt": "ISO-8601",

&#x20; "mode": "distributed | local-fallback",

&#x20; "stages": \[

&#x20;   {

&#x20;     "name": "10tps-10s",

&#x20;     "targetTps": 10,

&#x20;     "durationSeconds": 10,

&#x20;     "actualTps": 9.8,

&#x20;     "p50LatencyMs": 45,

&#x20;     "p95LatencyMs": 120,

&#x20;     "p99LatencyMs": 250,

&#x20;     "cacheHitRate": 0.92,

&#x20;     "broadcastQueueDepthMax": 5,

&#x20;     "rocksDbWriteLatencyP99Ms": 8,

&#x20;     "transactionTailQueueDepthMax": 3,

&#x20;     "failedBroadcasts": 0,

&#x20;     "unknownOutcomes": 0,

&#x20;     "inputRestorationForBroadcastTxs": 0,

&#x20;     "duplicateSpendAttempts": 0,

&#x20;     "clean": true,

&#x20;     "blocker": null

&#x20;   }

&#x20; ],

&#x20; "highestCleanStage": "50tps-10s",

&#x20; "bottleneckClassification": { "category": "none", "evidence": {} },

&#x20; "inputRestorationForBroadcastTxs": 0,

&#x20; "duplicateSpendAttempts": 0,

&#x20; "unknownOutcomeCount": 0,

&#x20; "failedBroadcastCount": 0,

&#x20; "cacheHitRate": 0.91,

&#x20; "queueBacklogGrowth": false,

&#x20; "jetStreamBacklog": 0,

&#x20; "rocksDbWriteLatencyP99": 12,

&#x20; "transactionTailQueueDepthMax": 8,

&#x20; "providerClassifications": {},

&#x20; "noMainnet": true,

&#x20; "noWp45": true,

&#x20; "doesNotClaim1000Tps": true,

&#x20; "evidenceHash": "sha256-of-full-metrics-dump"

}

```



\---



\# PHASE 9 — PROVIDER CAPACITY ARTIFACT



Create:



```text

docs/provider-capacity.md

```



Must document:



```text

\## Configured Endpoints

\- ARC endpoint URL(s)

\- WhatsOnChain endpoint URL(s)

\- Any other providers



\## Observed Testnet Behavior

\- Maximum sustained tx/s observed during harness run

\- Typical response latency (p50/p95/p99)

\- Rate limit thresholds observed (HTTP 429 frequency)

\- Unknown outcome frequency



\## Provider-Approved Capacity

\- Formally communicated tx/s limit per provider (if known)

\- Reference to provider documentation or support communication

\- If no formal approval exists: explicitly state "no formal approval"



\## Callback/Status Semantics

\- Per provider: how are broadcast results communicated

\- Polling vs callback vs SSE

\- Status transition expectations



\## Rejection/Unknown Outcome Classification

\- What constitutes terminal rejection (invalid script, double-spend proof from provider)

\- What constitutes unknown outcome (timeout, ambiguous response)

\- How unknowns are reconciled (not blindly retried)



\## Provider Rotation/Failover Strategy

\- Order of provider attempts

\- Failover logic

\- Rate limit backoff behavior



\## Scope Statement

\- Which endpoints are testnet-only

\- No 1000 tx/s provider approval is claimed unless evidence is attached

\- No mainnet load has been run

```



\---



\# PHASE 10 — STAGED TESTNET VALIDATION



Only run if ALL prerequisites are met:



```text

✓ Phase 1 (reviewStatusIdb) tests pass

✓ Phase 2 (broadcast recovery integration) tests pass

✓ Phase 3 (NatsManager) is configured OR local fallback explicitly chosen

✓ Provider capacity doc exists (Phase 9)

✓ TESTNET\_LOAD\_ENABLED=1

✓ Funded testnet wallet available

✓ ARC\_URL and ARC\_API\_KEY configured

```



Run:



```text

Stage 1: 10 TPS × 10 seconds

Stage 2: 10 TPS × 60 seconds

Stage 3: 50 TPS × 10 seconds

```



Clean stage criteria (ALL must be true to pass a stage):



```text

✓ inputRestorationForBroadcastTxs = 0

✓ duplicateSpendAttempts = 0

✓ sameTxidReuseVerified = true (same txid on every retry)

✓ queueBacklogGrowth = false (queue not growing over time)

✓ jetStreamBacklog stable (if distributed mode)

✓ cacheHitRate >= 0.90 OR exact bottleneck classified

✓ transactionTailQueueDepthMax < 50 OR contention classified

✓ unknownOutcomes classified and recorded

✓ failedBroadcasts classified (not silently dropped)

✓ no mainnet path executed

✓ no WP45/circulation ramp executed

✓ no 1000 TPS claim made

✓ proof/finality may remain async/pending (not required to complete in-stage)

```



If a stage fails:



```text

\- STOP IMMEDIATELY

\- Write exact blocker in artifact

\- Classify bottleneck (which category from Phase 8 classification)

\- Do NOT proceed to higher load

\- Record partial results for completed stages

```



\---



\# PHASE 11 — DISTRIBUTED ACCEPTANCE TESTS



Only run after Stage 3 (50 TPS × 10s) passes clean.



Create:



```text

test/distributed/NatsBroadcastConsumer.integration.test.ts

```



Prerequisites:



```text

\- NATS server running (NATS\_URL set)

\- NatsManager operational

\- TX\_BROADCAST stream created

\- At least 2 broadcast consumer instances configurable

```



Test scenarios:



\### 11.1 — Exactly-Once Processing



```text

\- Start 2 BroadcastConsumer instances on same durable group 'broadcast-workers'

\- Publish 100 TxBroadcastMessages with unique idempotencyKeys

\- Verify: exactly 100 total ACKs

\- Verify: each message processed by exactly one consumer

\- Verify: no duplicate broadcast attempts recorded in RocksDB

```



\### 11.2 — Duplicate Message Deduplication



```text

\- Publish same TxBroadcastMessage twice with same Nats-Msg-Id within duplicate\_window (2min)

\- Verify: JetStream deduplicates — only one message delivered to consumer

\- Verify: only one attempt record in RocksDB

\- Verify: no duplicate provider call

```



\### 11.3 — Consumer Restart Recovery



```text

\- Consumer A begins processing a message

\- Simulate Consumer A crash (do not ACK)

\- After ack\_wait (30s): message redelivers to Consumer B

\- Consumer B processes and ACKs

\- Verify: exactly one attempt record written (idempotent on storage side)

\- Verify: same txid used (not a replacement tx)

```



\### 11.4 — Max Deliver Exceeded (Dead Letter)



```text

\- Consumer NACKs same message 3 times (max\_deliver=3)

\- Message exceeds delivery limit

\- Verify: message routes to dead-letter subject

\- Verify: no broadcast attempt was completed

\- Verify: provenTxReq remains in 'unsent' or appropriate pending state

```



\### 11.5 — Malformed Message Handling



```text

\- Publish message with missing txid field

\- Consumer detects malformed payload

\- Consumer ACKs (removes from queue) and routes to dead-letter

\- Verify: no broadcast attempt made

\- Verify: no storage mutation

```



\### 11.6 — Unknown Provider Outcome



```text

\- Provider returns ambiguous/unclassifiable response

\- Consumer records outcome as 'unknown' on provenTxReq

\- Consumer ACKs (does NOT rebroadcast blindly)

\- Verify: provenTxReq has reconciliation marker

\- Verify: no second broadcast message published for same idempotencyKey

\- Verify: next reconciliation pass will handle it (not blind retry)

```



Write:



```text

.tmp/wallet-toolbox-distributed-broadcast/latest.json

```



Required artifact fields:



```json

{

&#x20; "ok": true,

&#x20; "consumers": 2,

&#x20; "totalMessages": 100,

&#x20; "processedExactlyOnce": true,

&#x20; "duplicateExternalEffects": 0,

&#x20; "unknownOutcomeCount": 0,

&#x20; "deadLetterCount": 0,

&#x20; "restartRecoveredClean": true,

&#x20; "sameTxidReused": true,

&#x20; "noReplacementTxGenerated": true,

&#x20; "noRedis": true,

&#x20; "noBullMq": true,

&#x20; "evidenceHash": "sha256"

}

```



\---



\# PHASE 12 — SCALE LADDER ROADMAP (DOCUMENT ONLY — DO NOT EXECUTE)



If all previous phases pass, create:



```text

docs/scale-ladder-roadmap.md

```



Document the next validation rungs. DO NOT run them in this goal:



```text

Rung 4: 100 TPS × 10 seconds

Rung 5: 100 TPS × 60 seconds

Rung 6: 500 TPS × 10 seconds

Rung 7: 1000 TPS × 10 seconds

Rung 8: 1000 TPS × 60 seconds

```



For each rung document:



```text

\- Prerequisites (what must pass first)

\- Expected bottleneck category

\- Tuning changes to attempt:

&#x20; - RocksDB: parallelismThreads, blockCacheSize, writeBatch grouping

&#x20; - Cache: UtxoCacheManager max entries (10K→50K), TTL (30s→120s)

&#x20; - HTTP pool: UndiciHttpClient connections (50→200), pipelining (10→20)

&#x20; - TaskSendWaiting: chunkLimit (500→1000), concurrency (100→200)

&#x20; - JetStream: consumer concurrency, ack\_wait tuning

&#x20; - transactionTail: key-scoped locking or native RocksDB transactions

\- Provider capacity required

\- Infrastructure scaling needed (NATS replicas, RocksDB disk IOPS)

\- Success criteria

```



Explicit statement:



```text

No rung above 50 TPS × 10 seconds has been validated.

No 1000 tx/s claim is made.

Higher rungs require:

&#x20; - Proven provider capacity approval

&#x20; - transactionTail bottleneck resolution (if identified)

&#x20; - Distributed consumer horizontal scaling

&#x20; - RocksDB tuning under sustained write load

```



\---



\# ALL TESTS TO ADD OR EXTEND



```text

test/storage/reviewStatusRocksDb.test.ts

&#x20; — Steps 2 and 3 in RocksDB path

&#x20; — Safety guard blocks restoration for live txs

&#x20; — Legitimate restoration for never-broadcast terminal failures

&#x20; — Completed marking when ProvenTx exists



test/monitor/BroadcastRecovery.integration.test.ts

&#x20; — Scenarios 3b, 8, 9, 10, 11 (full lifecycle)

&#x20; — Both monitor task path and storage path



test/messaging/NatsManager.test.ts

&#x20; — Stream creation (idempotent)

&#x20; — Publish with Nats-Msg-Id

&#x20; — Consume and ACK

&#x20; — Duplicate window deduplication

&#x20; — Connection health check



test/messaging/BroadcastPublisher.test.ts

&#x20; — IdempotencyKey generation correctness

&#x20; — Publish to correct subject

&#x20; — No rawTxHex in message payload



test/messaging/BroadcastConsumer.jetstream.test.ts

&#x20; — Message parsing

&#x20; — Provider classification for all response types

&#x20; — ACK after storage write

&#x20; — NACK on transient failure

&#x20; — Dead-letter on malformed

&#x20; — Unknown outcome does NOT trigger blind retry



test/cache/CacheNotAuthority.test.ts

&#x20; — Cache result never sets output.spendable

&#x20; — Cache miss falls through to provider

&#x20; — After clear(), fresh lookups proceed



test/guards/NoBannedDependencies.test.ts

&#x20; — No redis/ioredis/bullmq/bull in package.json



test/distributed/NatsBroadcastConsumer.integration.test.ts

&#x20; — Phase 11 scenarios (exactly-once, dedup, restart, dead-letter, malformed, unknown)



test/performance/TestnetThroughput.load.ts

&#x20; — Gated real-network harness (Phase 8)

```



\---



\# VERIFY (run after each phase)



```bash

npm run build

npm test

npm run depcheck

```



Targeted runs if full suite is slow:



```bash

npm test -- reviewStatusRocksDb

npm test -- BroadcastRecovery

npm test -- NatsManager

npm test -- BroadcastPublisher

npm test -- BroadcastConsumer

npm test -- CacheNotAuthority

npm test -- NoBannedDependencies

npm test -- NatsBroadcastConsumer

```



If full suite has unrelated pre-existing failures:



```text

\- Record exact blocker in artifact

\- Targeted safety/distributed tests MUST still pass

\- Do not hide failures

\- Do not claim success if targeted tests fail

```



\---



\# FINAL ARTIFACT



Write:



```text

.tmp/wallet-toolbox-distributed-scale-refactor/latest.json

```



Required fields:



```json

{

&#x20; "ok": true,

&#x20; "scope": "wallet-toolbox-distributed-scale-refactor",

&#x20; "generatedAt": "ISO-8601",

&#x20; "phasesCompleted": \["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],

&#x20; "inventoryWritten": true,

&#x20; "reviewStatusRocksDbCompleted": true,

&#x20; "broadcastRecoveryTestsPassing": true,

&#x20; "natsManagerImplemented": true,

&#x20; "natsStreamsCreated": \["TX\_BROADCAST", "UTXO\_STATUS", "BLOCK\_EVENTS", "PROOF\_REQUESTS", "CACHE\_INVALIDATE"],

&#x20; "broadcastPublisherImplemented": true,

&#x20; "broadcastConsumerJetStreamBacked": true,

&#x20; "proofRequestPipelineImplemented": true,

&#x20; "cacheInvalidationDistributed": true,

&#x20; "undiciProviderPoolingVerified": true,

&#x20; "cacheNotAuthorityTestsPassing": true,

&#x20; "rocksDbIndexesVerified": true,

&#x20; "transactionTailInstrumented": true,

&#x20; "realNetworkHarnessCreated": true,

&#x20; "providerCapacityDocWritten": true,

&#x20; "stagedValidationHighestCleanStage": "50tps-10s",

&#x20; "distributedAcceptanceStatus": "passed",

&#x20; "inputRestorationForBroadcastTxs": 0,

&#x20; "duplicateSpendAttempts": 0,

&#x20; "duplicateExternalEffects": 0,

&#x20; "unknownOutcomeCount": 0,

&#x20; "transactionTailBottleneckIdentified": false,

&#x20; "noRedis": true,

&#x20; "noBullMq": true

