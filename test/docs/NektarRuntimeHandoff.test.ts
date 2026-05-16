import { readFile } from 'fs/promises'
import path from 'path'

describe('Nektar runtime handoff documentation', () => {
  test('preserves JetStream stream contracts outside wallet-toolbox runtime code', async () => {
    const handoff = await readFile(path.join(process.cwd(), 'docs/nektar-runtime-handoff.md'), 'utf8')

    for (const stream of ['TX_BROADCAST', 'UTXO_STATUS', 'BLOCK_EVENTS', 'PROOF_REQUESTS']) {
      expect(handoff).toContain(`### \`${stream}\``)
      expect(handoff).toContain(`| \`${stream}\``)
    }

    expect(handoff).toContain('`tx.broadcast.<chain>`')
    expect(handoff).toContain('`utxo.status.<chain>.<txid>`')
    expect(handoff).toContain('`utxo.invalidate.<chain>.<walletStorageIdentityKey>`')
    expect(handoff).toContain('`block.mined.<chain>`')
    expect(handoff).toContain('`block.header.<chain>`')
    expect(handoff).toContain('`block.reorg.<chain>`')
    expect(handoff).toContain('`proof.request.<chain>`')
    expect(handoff).toContain('`proof.result.<chain>.<txid>`')

    expect(handoff).toContain('"idempotencyKey": "test:storage-identity:123:64-byte-hex"')
    expect(handoff).toContain('Ack only after the worker records the provider attempt result')
    expect(handoff).toContain('Retries must reuse the same signed transaction data')
    expect(handoff).toContain('Wallet storage remains authoritative')
    expect(handoff).toContain('`isUtxo` must not be copied into wallet spendability state directly')
  })

  test('preserves adapter mappings, runtime metrics, and NATS acceptance gates', async () => {
    const handoff = await readFile(path.join(process.cwd(), 'docs/nektar-runtime-handoff.md'), 'utf8')

    for (const mapping of [
      'CacheInvalidationPublisher.publishUtxoStatus(payload)',
      'Monitor.processNewBlockHeader',
      'Monitor.processBlockMinedNotice(height, hash, header, outpoints)',
      'CacheInvalidationPublisher.publishBlockInvalidation(height, outpoints)',
      'EventBus.emitBlockMined({ blockHeight, blockHash, header, outpoints })',
      'EventBus.emitReorg',
      'Monitor.processReorg'
    ]) {
      expect(handoff).toContain(mapping)
    }

    for (const metric of [
      'nektar_nats_message_latency_seconds',
      'nektar_nats_stream_backlog',
      'nektar_nats_consumer_redeliveries_total',
      'nektar_nats_consumer_ack_failures_total',
      'nektar_nats_publish_failures_total',
      'nektar_nats_worker_processing_seconds'
    ]) {
      expect(handoff).toContain(metric)
    }

    for (const gate of [
      'Publish `TX_BROADCAST`, restart one worker, then ack from another worker',
      'Worker nacks or exceeds `ack_wait`',
      'Republish the same `idempotencyKey` inside the duplicate window',
      'Kill one NATS node in a 3-replica stream',
      'Restore a stream snapshot into staging',
      'Connect with invalid TLS/client credentials',
      'Publish malformed payload schema',
      '`BLOCK_EVENTS` reorg payload arrives',
      '`BLOCK_EVENTS` mined payload includes affected `outpoints`'
    ]) {
      expect(handoff).toContain(gate)
    }
  })

  test('preserves runtime-only stream settings, rollout gates, and boundary rules', async () => {
    const handoff = await readFile(path.join(process.cwd(), 'docs/nektar-runtime-handoff.md'), 'utf8')

    for (const streamSetting of [
      '| `TX_BROADCAST` | `tx.broadcast.>` | limits | file | 3 | 7d | 10GB | 2m |',
      '| `UTXO_STATUS` | `utxo.status.>`, `utxo.invalidate.>` | limits | file | 3 | 24h | 5GB | 2m |',
      '| `BLOCK_EVENTS` | `block.>` | limits | file | 3 | 30d | 10GB | 2m |',
      '| `PROOF_REQUESTS` | `proof.request.>`, `proof.result.>` | limits | file | 3 | 7d | 10GB | 2m |'
    ]) {
      expect(handoff).toContain(streamSetting)
    }

    for (const securityOrRecoveryRule of [
      'Use TLS listeners for all runtime worker connections.',
      'least-privilege publish/subscribe permissions per',
      'Snapshot JetStream stream state to object storage on an operator-defined',
      'Test restore into a staging cluster before relying on snapshots.',
      'Keep RocksDB filesystem snapshots outside wallet-toolbox'
    ]) {
      expect(handoff).toContain(securityOrRecoveryRule)
    }

    for (const rolloutGate of [
      '4-lane, 8-lane, 10 TPS x 10s, 10 TPS x 60s',
      'same signed transaction data and txid reused across provider retries',
      'queue backlog and redelivery checks under worker restart',
      'proof/finality reconciliation after broadcast success',
      'cache invalidation and reorg replay during active traffic'
    ]) {
      expect(handoff).toContain(rolloutGate)
    }

    for (const boundaryRule of [
      'Cache may accelerate read hints only.',
      'Broadcast retries must reuse the same signed transaction data and same txid.',
      'Runtime workers must not generate a replacement transaction as a blind retry.',
      'Provider disagreement must be recorded per attempt',
      'wallet-toolbox must not',
      'import NATS, Redis, BullMQ, Temporal workers, lane workers, or operator'
    ]) {
      expect(handoff).toContain(boundaryRule)
    }
  })
})
