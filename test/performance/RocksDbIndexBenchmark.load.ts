import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { RocksDbWalletStore } from '../../src/storage/rocksdb'
import { hashOutputLockingScript } from '../../src/storage/outputScriptMetadata'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'

const SCRIPT_BUCKETS = 16

async function main (): Promise<void> {
  const count = numberFromEnv('ROCKSDB_BENCH_OUTPUTS', 1000)
  const outpointChecks = Math.min(numberFromEnv('ROCKSDB_BENCH_OUTPOINTS', 100), count)
  const maxQueryMs = optionalNumberFromEnv('ROCKSDB_BENCH_MAX_QUERY_MS')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-rocksdb-bench-'))
  const dbPath = path.join(dir, 'wallet.rocksdb')
  const store = await RocksDbWalletStore.open({ path: dbPath })

  try {
    const seed = await timed(async () => {
      for (let i = 0; i < count; i++) {
        await store.putOutput(makeOutput(i))
      }
    })

    const targetScriptBucket = 3
    const targetBasketId = 1
    const targetScriptHash = hashOutputLockingScript(lockingScriptForBucket(targetScriptBucket))
    const scriptHashQuery = await timed(async () => await store.findOutputsByScriptHash(targetScriptHash))
    const spendableQuery = await timed(async () => await store.findSpendableOutputs(7))
    const basketQuery = await timed(async () => await store.findSpendableOutputs(7, targetBasketId))
    const outpoints = Array.from({ length: outpointChecks }, (_, i) => ({
      txid: txidForIndex(i),
      vout: 0
    }))
    const outpointQuery = await timed(async () => await store.findOutputsByOutpoints(7, outpoints))

    const expectedScriptHash = expectedCount(count, i => i % SCRIPT_BUCKETS === targetScriptBucket)
    const expectedSpendable = expectedCount(count, i => i % 2 === 0)
    const expectedBasket = expectedCount(count, i => i % 2 === 0 && basketIdForIndex(i) === targetBasketId)

    assertEqual(scriptHashQuery.value.length, expectedScriptHash, 'scriptHash result count')
    assertEqual(spendableQuery.value.length, expectedSpendable, 'spendable result count')
    assertEqual(basketQuery.value.length, expectedBasket, 'basket result count')
    assertEqual(Object.keys(outpointQuery.value).length, outpointChecks, 'outpoint result count')

    const summary = {
      outputs: count,
      outpointChecks,
      targetBasketId,
      seedMs: round(seed.elapsedMs),
      scriptHashQueryMs: round(scriptHashQuery.elapsedMs),
      spendableQueryMs: round(spendableQuery.elapsedMs),
      basketQueryMs: round(basketQuery.elapsedMs),
      outpointQueryMs: round(outpointQuery.elapsedMs),
      resultCounts: {
        scriptHash: scriptHashQuery.value.length,
        spendable: spendableQuery.value.length,
        basket: basketQuery.value.length,
        outpoint: Object.keys(outpointQuery.value).length
      },
      tuning: store.getTuningOptions()
    }

    console.log(JSON.stringify(summary, null, 2))
    if (maxQueryMs !== undefined) {
      for (const [name, elapsedMs] of Object.entries({
        scriptHashQuery: scriptHashQuery.elapsedMs,
        spendableQuery: spendableQuery.elapsedMs,
        basketQuery: basketQuery.elapsedMs,
        outpointQuery: outpointQuery.elapsedMs
      })) {
        if (elapsedMs > maxQueryMs) {
          throw new Error(`${name} took ${round(elapsedMs)}ms, above threshold ${maxQueryMs}ms`)
        }
      }
    }
  } finally {
    store.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function makeOutput (index: number): TableOutput {
  const now = new Date(0)
  return {
    created_at: now,
    updated_at: now,
    outputId: index + 1,
    userId: 7,
    transactionId: index + 1,
    basketId: basketIdForIndex(index),
    spendable: index % 2 === 0,
    change: false,
    outputDescription: 'benchmark output',
    vout: 0,
    satoshis: 1,
    providedBy: 'you',
    purpose: 'benchmark',
    type: 'custom',
    txid: txidForIndex(index),
    lockingScript: lockingScriptForBucket(index % SCRIPT_BUCKETS)
  }
}

function lockingScriptForBucket (bucket: number): number[] {
  return [0x51, bucket]
}

function basketIdForIndex (index: number): number {
  return (index % 8) + 1
}

function txidForIndex (index: number): string {
  return index.toString(16).padStart(64, '0')
}

function expectedCount (count: number, predicate: (index: number) => boolean): number {
  let matches = 0
  for (let i = 0; i < count; i++) {
    if (predicate(i)) matches++
  }
  return matches
}

async function timed<T> (work: () => Promise<T>): Promise<{ elapsedMs: number, value: T }> {
  const started = process.hrtime.bigint()
  const value = await work()
  return {
    elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
    value
  }
}

function assertEqual (actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`Expected ${label} ${expected}, got ${actual}`)
}

function numberFromEnv (name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.trunc(value)
}

function optionalNumberFromEnv (name: string): number | undefined {
  if (process.env[name] === undefined) return undefined
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function round (value: number): number {
  return Number(value.toFixed(3))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
