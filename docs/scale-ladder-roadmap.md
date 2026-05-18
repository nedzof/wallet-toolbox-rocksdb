# Scale Ladder Roadmap

This package now has two execution modes:

- Local mode: no `NATS_URL`; monitor tasks keep direct in-process broadcast behavior.
- Distributed mode: `NATS_URL` present; `TaskSendWaiting` publishes signed transaction references to JetStream and workers load private raw transaction data from storage.

## Implemented Ladder

1. RocksDB status recovery restores inputs only after safe terminal request states.
2. Broadcast recovery tests cover rebroadcast, never-broadcast invalidation, and circuit breaker behavior.
3. JetStream stream definitions, message contracts, idempotent publish keys, durable consumer defaults, and dependency guards are in place.
4. Broadcast publishing uses reference-only messages and keeps raw transaction bytes out of public streams.
5. Cache invalidation remains local-first and can also publish distributed invalidation messages.
6. Proof request and block-event adapters are interface-based so deployment code can bind real storage and provider implementations.
7. The real-network testnet harness is gated, writes an artifact, and stops at `50tps-10s`.

## Next Ladder Rungs

Before going past `50tps-10s`, validate:

- provider limits and API contracts for the selected ARC endpoint
- NATS stream replicas and disk I/O under worker restart
- RocksDB transaction tail latency under the same hardware profile as production
- duplicate external effects remain zero across worker restarts and duplicate deliveries

Higher targets should be introduced one stage at a time after the previous artifact is clean.
