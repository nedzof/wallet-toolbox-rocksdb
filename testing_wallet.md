Here's the `/goal` prompt for your coding agent:



\---



```

/goal Build a real-network testnet load harness for wallet-toolbox-rocksdb that validates 1000 tx/s throughput with actual RocksDB I/O, real ARC provider HTTP calls, and real UTXO management. The existing mocked harness at test/performance/SingleInstanceThroughput.load.ts proves queue/concurrency architecture only — it uses setImmediate yields instead of real I/O. This goal creates the real counterpart.



\## Context



The wallet-toolbox-rocksdb repo has a complete single-instance scalability architecture already implemented:

\- BroadcastOrchestrator (src/broadcast/BroadcastOrchestrator.ts) with p-queue, priority, concurrency 100

\- UndiciHttpClient (src/http/UndiciHttpClient.ts) with 50-connection pools, pipelining 10, HTTP/2

\- UtxoCacheManager (src/cache/UtxoCacheManager.ts) with LRU 10K entries, 30s TTL

\- BlockHeaderCache (src/cache/BlockHeaderCache.ts) with node-cache 1K entries, 5min TTL

\- ScriptHashCache (src/cache/ScriptHashCache.ts) with LRU 10K entries, 5min TTL

\- EventBus (src/events/EventBus.ts) with BLOCK\_MINED, UTXO\_INVALIDATE, REORG events

\- TaskSendWaiting (src/monitor/tasks/TaskSendWaiting.ts) with 1s trigger, 500 chunk, 100 concurrency

\- WalletToolboxMetrics (src/metrics/WalletToolboxMetrics.ts) with Prometheus counters/histograms/gauges

\- AdminServer (src/storage/adminServer/adminServer.ts) exposes GET /metrics before auth

\- Services (src/services/Services.ts) defaults to postBeefMode: 'PromiseAll', postBeefQueueConcurrency: 100

\- createDefaultWalletServicesOptions (src/services/createDefaultWalletServicesOptions.ts) wires defaults including testnet ARC URLs and undici pooled HTTP

\- RocksDB prefix indexes with parallelismThreads=12



The mocked harness (test/performance/SingleInstanceThroughput.load.ts) observes 35-52K mocked TPS. Real-network throughput is unproven.



\## Deliverables



\### 1. Real-network load harness: test/performance/TestnetThroughput.load.ts



Create a guarded testnet load harness that:

\- Is gated by environment variables: TESTNET\_LOAD\_ENABLED=1, TAAL\_ARC\_API\_KEY, and a funded testnet wallet mnemonic or WIF via TESTNET\_WALLET\_WIF

\- Opens a real RocksDB store in a temp directory (clean per run)

\- Creates a real Services instance with chain='test' and real ARC/WoC endpoints

\- Creates a real Wallet with RocksDB storage and real services

\- Ramps load in stages: 10 tx/s for 10s, then 50 tx/s for 10s, then 100 tx/s for 10s, then 500 tx/s for 10s, then 1000 tx/s for 10s

\- At each stage, creates simple P2PKH self-send transactions using createAction

\- Measures and logs per-stage: actual TPS achieved, p50/p95/p99 latency per createAction call, cache hit rates (from services.utxoCache.getStats(), services.blockHeaderCache.getStats(), services.scriptHashCache.getStats()), broadcast queue depth (from services.metrics), RocksDB storage query latency (from services.metrics), number of failed/retried broadcasts

\- After each stage, scrapes services.metrics.metrics() and logs the full Prometheus output

\- At the end, prints a summary table of all stages and identifies the bottleneck stage (where actual TPS first drops below target TPS)

\- Cleans up: calls wallet.destroy(), removes temp RocksDB directory

\- If TESTNET\_LOAD\_ENABLED is not set, prints "Skipped: set TESTNET\_LOAD\_ENABLED=1 with funded testnet credentials" and exits 0



\### 2. Add npm script: package.json



Add:

```json

"loadtest:testnet": "npx ts-node test/performance/TestnetThroughput.load.ts"

```



\### 3. Observability snapshot helper: test/performance/metricsSnapshot.ts



Create a small helper that:

\- Takes a WalletToolboxMetrics instance

\- Parses the Prometheus text output into a structured object with key metrics: utxo\_cache\_hit\_rate, block\_header\_cache\_hit\_rate, post\_beef\_queue\_size, post\_beef\_queue\_pending, send\_waiting\_queue\_size, send\_waiting\_queue\_pending, and p95 broadcast latency

\- Returns a typed MetricsSnapshot object for programmatic comparison between stages



\### 4. Update docs/practical-testing-plan.md



Create or update this doc with:

\- Prerequisites: testnet API keys, funded wallet, recommended hardware (SSD for RocksDB)

\- How to run: `TESTNET\_LOAD\_ENABLED=1 TAAL\_ARC\_API\_KEY=xxx TESTNET\_WALLET\_WIF=xxx npm run loadtest:testnet`

\- What to watch: which Prometheus metrics indicate the bottleneck

\- Decision tree: if bottleneck is ARC latency → need more providers or Nektar fanout; if bottleneck is RocksDB writes → need binding upgrade or write batching; if bottleneck is UTXO cache misses → tune TTL or max entries; if bottleneck is queue backlog → tune concurrency limits

\- Success criteria: sustained 1000 tx/s for 10 seconds with p99 createAction latency under 500ms and no queue backlog growth



\### 5. Update docs/refactor-rocksdb-implementation-audit.md



Add a row to the checklist table:

| Real-network testnet load test | test/performance/TestnetThroughput.load.ts with staged ramp to 1000 tx/s | Implemented |



\## Constraints



\- Do NOT add any new runtime dependencies. The harness uses only existing deps (lru-cache, p-limit, undici, prom-client, etc.) plus Node built-ins.

\- Do NOT modify any src/ production code. This is a test/docs-only change.

\- The harness must exit cleanly even if ARC rate-limits or the wallet runs out of UTXOs. Log the failure stage and exit 0 with a clear message.

\- Use RocksDbWalletStore for storage, not SQLite/Knex.

\- The harness should be safe to run in CI with TESTNET\_LOAD\_ENABLED unset (it just skips).



\## Verification



After implementation:

1\. npm run build must pass

2\. npm run loadtest:testnet without env vars must print skip message and exit 0

3\. npm run depcheck must pass with 0 errors

4\. git diff --check must pass

```



\---



This prompt gives the agent everything it needs: the exact architecture context, file paths, what to build, what to measure, and clear success criteria. The staged ramp (10 -> 50 -> 100 -> 500 -> 1000 tx/s) will identify exactly where the real bottleneck is rather than going straight to 1000 and getting a binary pass/fail.
