# Nektar Runtime Handoff

Date: 2026-05-16

`wallet-toolbox-rocksdb` remains a wallet library. It owns local wallet storage,
RocksDB indexes, transaction construction/signing records, provider HTTP
clients, in-process caches, and monitor tasks. It does not own Redis, BullMQ,
NATS JetStream, lane fanout, proof queues, or operator workflows.

## Wallet-Toolbox-Owned Signals

These in-process signals are available for a Nektar runtime bridge to observe or
adapt without making wallet-toolbox depend on a runtime bus:

- `EventBus.BLOCK_MINED`: emitted by `SpvHeaderSync`,
  `Monitor.processNewBlockHeader`, and `TaskArcadeSSE` block events. A runtime
  bridge that has already computed affected wallet outpoints may pass them
  through `EventBus.emitBlockMined({ ..., outpoints })`,
  `Monitor.processBlockMinedNotice(height, hash, header, outpoints)`, or
  `CacheInvalidationPublisher.publishBlockInvalidation(height, outpoints)` for
  targeted cache invalidation; wallet-toolbox falls back to clearing cached UTXO
  hints when block contents are unknown. `TaskArcadeSSE` forwards an optional
  `outpoints` array from `BLOCK_MINED` SSE payloads into the same path.
- `EventBus.UTXO_INVALIDATE`: emitted when wallet-owned outpoints are confirmed
  spent or invalidated.
- `EventBus.REORG`: emitted by `SpvHeaderSync` and `Monitor.processReorg`.
- `Services.postBeef`: submits the same signed BEEF and txid set to configured
  providers and records provider call metrics.
- `TaskSendWaiting`: processes wallet outbox records locally with bounded
  concurrency and retry priority.
- `WalletToolboxMetrics`: exposes cache, broadcast, queue, and storage metrics.

## Nektar-Owned Runtime Streams

If Nektar adopts JetStream, these streams should live in Nektar packages such as
`packages/endurance`, `packages/runtime-workers`, or `packages/runtime-temporal`,
not inside wallet-toolbox:

- `TX_BROADCAST`: broadcast work queue carrying one signed BEEF/raw tx, one txid
  set, one outbox id, and retry metadata.
- `UTXO_STATUS`: observed spend status updates and cache-invalidation hints.
- `BLOCK_EVENTS`: block headers, block mined notices, and reorg events.
- `PROOF_REQUESTS`: proof lookup and finality work that can complete
  asynchronously after broadcast.

## Suggested JetStream Contracts

These contracts are deliberately written as runtime guidance rather than
wallet-toolbox code. Nektar may rename subjects, but it should preserve the
idempotency and authority rules.

### `TX_BROADCAST`

Subjects:

- `tx.broadcast.<chain>`
- `tx.broadcast.<chain>.<walletStorageIdentityKey>`

Producer:

- Nektar adapter after wallet-toolbox has created one signed transaction and one
  outbox/proven-tx request record.

Consumer:

- Durable broadcast worker group, explicit ack.

Payload:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "walletStorageIdentityKey": "storage-identity",
  "identityKey": "wallet-identity",
  "provenTxReqId": 123,
  "txid": "64-byte-hex",
  "txids": ["64-byte-hex"],
  "rawTxHex": "optional raw tx hex when available",
  "inputBeefHex": "optional BEEF hex when available",
  "attempt": 2,
  "priority": 2,
  "createdAt": "2026-05-16T00:00:00.000Z",
  "idempotencyKey": "test:storage-identity:123:64-byte-hex"
}
```

Ack rule:

- Ack only after the worker records the provider attempt result against the same
  wallet outbox/proven-tx request. If provider outcome is unknown, record
  `unknown` and stop for reconciliation instead of generating another
  transaction.

Idempotency rule:

- Retries must reuse the same signed transaction data, same `txid`, same
  `provenTxReqId`, and same `idempotencyKey`.

### `UTXO_STATUS`

Subjects:

- `utxo.status.<chain>.<txid>`
- `utxo.invalidate.<chain>.<walletStorageIdentityKey>`

Producer:

- Nektar chain observers or broadcast/proof workers.

Consumer:

- Cache invalidation workers and optional wallet adapter bridges.

Payload:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "walletStorageIdentityKey": "storage-identity",
  "outpoints": ["txid.vout"],
  "isUtxo": false,
  "blockHeight": 123456,
  "source": "arc|woc|bitails|chaintracks",
  "observedAt": "2026-05-16T00:00:00.000Z"
}
```

Authority rule:

- This stream is a cache and review hint. Wallet storage remains authoritative,
  and wallet-toolbox should still use fresh provider checks before spendability
  mutations.
- A wallet adapter may map any `UTXO_STATUS` payload with `outpoints` to
  `CacheInvalidationPublisher.publishUtxoStatus(payload)`,
  `CacheInvalidationPublisher.publishUtxoInvalidation({ outpoints, blockHeight })`,
  or `EventBus.emitUtxoInvalidation({ outpoints, blockHeight })`.
- `isUtxo` must not be copied into wallet spendability state directly. It only
  tells the adapter that cached read hints for those outpoints should be
  discarded before the next wallet/provider check.

### `BLOCK_EVENTS`

Subjects:

- `block.mined.<chain>`
- `block.header.<chain>`
- `block.reorg.<chain>`

Producer:

- Nektar chaintracks/SPV runtime listeners.

Consumer:

- Cache invalidation workers, proof workers, and wallet adapter bridges.

Payload for `block.header` and `block.mined`:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "height": 123456,
  "hash": "block-hash",
  "previousHash": "previous-block-hash",
  "merkleRoot": "merkle-root",
  "time": 1710000000,
  "outpoints": ["optional wallet-owned txid.vout affected by this block"],
  "observedAt": "2026-05-16T00:00:00.000Z"
}
```

For `block.header`, omit `outpoints`. For `block.mined`, include `outpoints`
only when the runtime bridge has already derived affected wallet-owned
outpoints from block contents, proof results, or provider status updates. An
empty or omitted `outpoints` field must be treated as a cache hint boundary, not
as proof that no wallet outpoints changed.

Payload for `block.reorg`:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "depth": 2,
  "oldTip": { "height": 123456, "hash": "old-tip" },
  "newTip": { "height": 123456, "hash": "new-tip" },
  "deactivatedHeaders": [
    { "height": 123455, "hash": "deactivated" }
  ],
  "observedAt": "2026-05-16T00:00:00.000Z"
}
```

Wallet adapter mapping:

- `block.header` can call `Monitor.processNewBlockHeader` when a complete header
  is available.
- `block.mined` can call
  `Monitor.processBlockMinedNotice(height, hash, header, outpoints)` or
  `CacheInvalidationPublisher.publishBlockInvalidation(height, outpoints)` when
  affected wallet outpoints are known.
- `EventBus.emitBlockMined({ blockHeight, blockHash, header, outpoints })` is
  the lower-level in-process equivalent for adapters that do not own a monitor.
- `block.reorg` can call `EventBus.emitReorg` or `Monitor.processReorg`.

### `PROOF_REQUESTS`

Subjects:

- `proof.request.<chain>`
- `proof.result.<chain>.<txid>`

Producer:

- Broadcast workers, monitor adapters, or proof schedulers when finality work is
  needed after broadcast.

Consumer:

- Durable proof worker group, explicit ack.

Request payload:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "walletStorageIdentityKey": "storage-identity",
  "provenTxReqId": 123,
  "txid": "64-byte-hex",
  "requestedAt": "2026-05-16T00:00:00.000Z",
  "idempotencyKey": "test:storage-identity:proof:123:64-byte-hex"
}
```

Result payload:

```json
{
  "schemaVersion": 1,
  "chain": "test",
  "walletStorageIdentityKey": "storage-identity",
  "provenTxReqId": 123,
  "txid": "64-byte-hex",
  "status": "completed|unmined|unknown|doubleSpend|invalidTx",
  "blockHeight": 123456,
  "merklePath": "optional serialized proof",
  "providerAttempts": ["arc:success", "woc:unknown"],
  "observedAt": "2026-05-16T00:00:00.000Z"
}
```

Wallet adapter mapping:

- Results should update the existing wallet outbox/proven transaction records
  through wallet storage APIs. They should not directly rewrite wallet state
  outside the wallet storage contract.

## Suggested Consumer Settings

Runtime defaults should be conservative until Nektar has production load data:

| Stream | Durable group | Ack policy | Max deliver | Ack wait | Max ack pending |
| --- | --- | --- | --- | --- | --- |
| `TX_BROADCAST` | `broadcast-workers` | explicit | 3 | 30s | 500 |
| `UTXO_STATUS` | `utxo-cache-workers` | explicit | 3 | 15s | 1000 |
| `BLOCK_EVENTS` | `block-event-workers` | explicit | 5 | 30s | 1000 |
| `PROOF_REQUESTS` | `proof-workers` | explicit | 5 | 60s | 500 |

## Suggested Stream Settings

These are operator defaults for Nektar, not wallet-toolbox configuration:

| Stream | Subjects | Retention | Storage | Replicas | Max age | Max bytes | Duplicate window |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TX_BROADCAST` | `tx.broadcast.>` | limits | file | 3 | 7d | 10GB | 2m |
| `UTXO_STATUS` | `utxo.status.>`, `utxo.invalidate.>` | limits | file | 3 | 24h | 5GB | 2m |
| `BLOCK_EVENTS` | `block.>` | limits | file | 3 | 30d | 10GB | 2m |
| `PROOF_REQUESTS` | `proof.request.>`, `proof.result.>` | limits | file | 3 | 7d | 10GB | 2m |

Use discard-old limits for telemetry-like streams and preserve explicit durable
ack state for work queues. Nektar should size these limits from observed backlog
and recovery objectives rather than from wallet-toolbox defaults.

## Security And Operations

Nektar should own the JetStream security boundary:

- Use TLS listeners for all runtime worker connections.
- Use service credentials with least-privilege publish/subscribe permissions per
  subject group.
- Rotate user/password or nkey credentials through Nektar secrets management.
- Keep wallet identity keys and signing material inside wallet-toolbox or its
  storage contract; runtime events should carry references and signed
  transaction data, not private key material.
- Add NATS server, stream, and consumer metrics to Nektar operator dashboards.

## Suggested Runtime Metrics

Nektar should expose runtime-bus metrics from its worker packages rather than
from wallet-toolbox:

| Metric | Type | Labels | Purpose |
| --- | --- | --- | --- |
| `nektar_nats_message_latency_seconds` | histogram | `stream`, `consumer`, `subject` | End-to-end publish-to-ack latency. |
| `nektar_nats_stream_backlog` | gauge | `stream`, `consumer` | Pending messages for each durable consumer. |
| `nektar_nats_consumer_redeliveries_total` | counter | `stream`, `consumer` | Delivery retries caused by nacks, timeouts, or worker errors. |
| `nektar_nats_consumer_ack_failures_total` | counter | `stream`, `consumer` | Failed or rejected ack attempts. |
| `nektar_nats_publish_failures_total` | counter | `stream`, `subject` | Publish errors from adapters and workers. |
| `nektar_nats_worker_processing_seconds` | histogram | `stream`, `consumer`, `result` | Worker processing duration before ack/nak. |

Suggested alert conditions:

- Page on `TX_BROADCAST` backlog above 10,000 messages for 5 minutes.
- Page on p99 `TX_BROADCAST` message latency above 30 seconds for 5 minutes.
- Warn on sustained redelivery growth for any durable consumer.
- Warn when publish failures are non-zero over a 5 minute window.
- Warn when JetStream storage usage crosses Nektar's retention budget.

## Disaster Recovery

Nektar should own runtime recovery procedures:

- Snapshot JetStream stream state to object storage on an operator-defined
  schedule.
- Test restore into a staging cluster before relying on snapshots.
- Alert on stream backlog, consumer delivery failures, ack redelivery spikes, and
  storage pressure.
- Rebuild wallet-toolbox in-memory caches from wallet storage and provider/SPV
  state after process restart.
- Keep RocksDB filesystem snapshots outside wallet-toolbox if operators need
  point-in-time recovery; the current binding does not expose a dedicated online
  checkpoint API.

## Suggested Runtime Acceptance Tests

Nektar should verify the runtime bus independently from wallet-toolbox:

| Scenario | Expected result |
| --- | --- |
| Publish `TX_BROADCAST`, restart one worker, then ack from another worker | Message remains durable until exactly one worker records and acks the provider attempt. |
| Worker nacks or exceeds `ack_wait` | Message redelivers up to `max_deliver`, then enters Nektar's dead-letter/reconciliation path. |
| Republish the same `idempotencyKey` inside the duplicate window | Runtime dedupe or wallet outbox idempotency prevents duplicate provider state mutation. |
| Kill one NATS node in a 3-replica stream | Consumers continue from the surviving quorum without losing acknowledged messages. |
| Restore a stream snapshot into staging | Durable consumers can resume from restored state and process pending work once. |
| Connect with invalid TLS/client credentials | Connection is rejected before publish or subscribe permissions are granted. |
| Publish malformed payload schema | Consumer rejects or quarantines the message without calling wallet storage mutation APIs. |
| `BLOCK_EVENTS` reorg payload arrives | Adapter invokes the wallet reorg path and invalidates cache hints without treating cache state as authority. |
| `BLOCK_EVENTS` mined payload includes affected `outpoints` | Adapter forwards those outpoints into wallet-local block invalidation so matching UTXO cache hints are removed while unrelated hints may remain cached. |

## Runtime Rollout And Validation Gates

The source architecture's migration phases map to this ownership split:

1. Infrastructure: deploy and smoke-test the Nektar JetStream cluster, streams,
   durable consumer groups, TLS credentials, stream retention, and alerting.
2. Cache bridge: connect wallet-toolbox `EventBus` signals to Nektar
   `BLOCK_EVENTS` and `UTXO_STATUS` adapters, then verify cache invalidation and
   reorg handling without treating cache state as spend authority.
3. Broadcast workers: enqueue only already-signed wallet outbox work to
   `TX_BROADCAST`, record every provider attempt, and prove retry idempotency
   before increasing concurrency.
4. Storage/index rollout: enable wallet-toolbox RocksDB prefix indexes and
   schema columns first in a staging wallet, rebuild indexes, then compare query
   counts and latency against the previous storage path.
5. Real-time sync: connect SPV/header listeners to `BLOCK_EVENTS`, confirm
   proof workers wake on new blocks, and replay reorg fixtures against staging.
6. Monitor ownership: decide which queues are owned by Nektar workers and which
   remain local monitor tasks; disable overlapping ownership before production.
7. Throughput ladder: run 4-lane, 8-lane, 10 TPS x 10s, 10 TPS x 60s, then
   higher load only after queue backlog, provider outcomes, proof finality, and
   wallet storage state reconcile cleanly.

## Capacity And Configuration Notes

The source document's CPU, memory, disk, network, and JetStream storage targets
are Nektar deployment requirements, not wallet-toolbox library defaults. Nektar
should version runtime configuration in Git with environment-specific overlays
for stream limits, consumer settings, TLS credential references, worker
concurrency, provider pools, and alert thresholds.

Public-network 1000 tx/s validation should include:

- same signed transaction data and txid reused across provider retries;
- provider attempt classification for success, seen, rejected, and unknown;
- queue backlog and redelivery checks under worker restart;
- proof/finality reconciliation after broadcast success;
- cache invalidation and reorg replay during active traffic;
- RocksDB snapshot/restore rehearsal outside the wallet-toolbox process.

## Runtime Task Coordination

If Nektar moves wallet-adjacent work out of the in-process monitor, use the
streams as durable task ownership boundaries:

- `TX_BROADCAST` replaces external broadcast scheduling only after wallet-toolbox
  has persisted the signed outbox/proven-tx request.
- `PROOF_REQUESTS` owns async finality/proof lookup, but results must flow back
  through wallet storage APIs for the existing request id.
- `BLOCK_EVENTS` wakes proof/reorg/cache workers and wallet adapter bridges; it
  should not directly mutate wallet state.
- `UTXO_STATUS` invalidates or annotates caches and review queues only; it is not
  spend authority.
- Durable consumer ack state is the runtime work lease. Avoid adding a second
  ad-hoc lease table unless Nektar needs cross-stream workflow correlation.
- Runtime workers should record an idempotency key before side effects and ack
  only after the corresponding wallet/outbox update succeeds.
- Local wallet-toolbox monitor tasks can continue to run in single-instance mode;
  Nektar deployments should disable or narrow overlapping local tasks when an
  external worker owns the same queue.

## Boundary Rules

- Cache may accelerate read hints only. Wallet storage and fresh provider checks
  remain authoritative before spendability mutation.
- Broadcast retries must reuse the same signed transaction data and same txid.
  Runtime workers must not generate a replacement transaction as a blind retry.
- Provider disagreement must be recorded per attempt and reconciled through the
  outbox/proof-finality path.
- Nektar runtime code can wrap wallet-toolbox APIs, but wallet-toolbox must not
  import NATS, Redis, BullMQ, Temporal workers, lane workers, or operator
  workflow modules.

## Adapter Shape

A Nektar adapter can be implemented outside this repo with three narrow edges:

- Subscribe to wallet `EventBus` events and publish Nektar runtime events.
- Enqueue wallet outbox work into Nektar-owned `TX_BROADCAST` only after a
  wallet action has produced signed transaction data.
- Consume runtime proof/finality results by calling wallet storage APIs that
  update the existing outbox/proven transaction records.
