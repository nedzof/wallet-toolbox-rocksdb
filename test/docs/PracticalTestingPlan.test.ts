import { readFile } from 'fs/promises'
import path from 'path'

describe('practical testing plan', () => {
  test('keeps mocked load-test claims separate from real-network validation', async () => {
    const plan = await readFile(path.join(process.cwd(), 'docs/practical-testing-plan.md'), 'utf8')

    for (const statement of [
      '`npm run loadtest:single-instance` is a mocked in-process queue/concurrency',
      'does not prove production 1000 tx/s',
      'real RocksDB writes or compaction pressure',
      'real provider HTTP latency to ARC, WhatsOnChain, or Bitails',
      'real BEEF serialization or transaction construction cost',
      'public testnet/mainnet mining, proof finality, or reorg behavior'
    ]) {
      expect(plan).toContain(statement)
    }
  })

  test('preserves the staged practical test ladder and bottleneck checks', async () => {
    const plan = await readFile(path.join(process.cwd(), 'docs/practical-testing-plan.md'), 'utf8')

    for (const gate of [
      '10 tx/s for 10 seconds',
      '10 tx/s for 60 seconds',
      '100 tx/s for 60 seconds',
      '500 tx/s for 60 seconds',
      '1000 tx/s only after provider outcomes',
      'UTXO cache hit/miss rate',
      'target of at least 90%',
      'RocksDB get/put/delete/batch/scan/compact latency',
      'secondary index maintenance cost per output',
      'transaction construction or BEEF serialization CPU'
    ]) {
      expect(plan).toContain(gate)
    }
  })

  test('preserves cache safety and Nektar adapter boundaries', async () => {
    const plan = await readFile(path.join(process.cwd(), 'docs/practical-testing-plan.md'), 'utf8')

    for (const rule of [
      'no cache result is copied into wallet spendability state as authority',
      'fresh provider checks still gate spendability mutations',
      'Distributed scaling belongs in Nektar, not wallet-toolbox.',
      'durable `TX_BROADCAST` work is enqueued only after wallet-toolbox persists one',
      'retries reuse the same signed transaction and same txid',
      '`BLOCK_EVENTS` and `UTXO_STATUS` bridge into wallet-local cache invalidation'
    ]) {
      expect(plan).toContain(rule)
    }
  })
})
