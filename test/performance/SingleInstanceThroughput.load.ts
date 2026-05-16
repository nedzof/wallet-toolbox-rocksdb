import { Beef } from '@bsv/sdk'
import { BroadcastOrchestrator } from '../../src/broadcast/BroadcastOrchestrator'
import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'

async function main (): Promise<void> {
  const count = numberFromEnv('LOADTEST_TX_COUNT', 1000)
  const targetTps = numberFromEnv('LOADTEST_TARGET_TPS', 1000)
  const concurrency = numberFromEnv('LOADTEST_CONCURRENCY', 100)
  const beef = { toBinary: () => [] } as unknown as Beef
  let calls = 0
  let active = 0
  let maxActive = 0
  const services = {
    postBeef: async (_beef: Beef, txids: string[]): Promise<PostBeefResult[]> => {
      active += txids.length
      maxActive = Math.max(maxActive, active)
      try {
        await yieldToQueue()
        calls += txids.length
        return [{
          name: 'loadtest',
          status: 'success',
          txidResults: txids.map(txid => ({ txid, status: 'success' }))
        }]
      } finally {
        active -= txids.length
      }
    }
  }
  const orchestrator = new BroadcastOrchestrator(services, { concurrency })
  const started = process.hrtime.bigint()
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const txid = i.toString(16).padStart(64, '0')
      await orchestrator.broadcast({ beef, txids: [txid], attempts: i % 3 })
    })
  )
  const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000
  const tps = count / elapsedSeconds
  const summary = {
    mode: 'mocked-in-process',
    coverage: 'BroadcastOrchestrator queue/concurrency only',
    notCovered: [
      'RocksDB writes',
      'provider HTTP latency',
      'BEEF serialization',
      'testnet/public-network finality'
    ],
    count,
    calls,
    concurrency,
    maxActive,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    tps: Number(tps.toFixed(1)),
    targetTps
  }
  await orchestrator.close()
  console.log(JSON.stringify(summary, null, 2))
  if (calls !== count) throw new Error(`Expected ${count} tx calls, got ${calls}`)
  if (maxActive > concurrency) throw new Error(`Expected at most ${concurrency} active broadcasts, saw ${maxActive}`)
  if (count > 1 && maxActive <= 1) throw new Error(`Expected parallel broadcast work, saw maxActive=${maxActive}`)
  if (tps < targetTps) throw new Error(`Throughput ${tps.toFixed(1)} tx/s below target ${targetTps} tx/s`)
}

function numberFromEnv (name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

async function yieldToQueue (): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
