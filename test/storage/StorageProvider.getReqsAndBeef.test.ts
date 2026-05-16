import { StorageProvider } from '../../src/storage/StorageProvider'

describe('StorageProvider.getReqsAndBeefToShareWithWorld', () => {
  test('classifies txids with bounded parallel storage lookups and merges ready reqs in input order', async () => {
    const storage = Object.create(StorageProvider.prototype) as any
    let activeProvenLookups = 0
    let maxActiveProvenLookups = 0
    const readyReqs = new Map([
      ['ready-1', makeReq(1, 'ready-1')],
      ['ready-2', makeReq(2, 'ready-2')]
    ])
    const mergedTxids: string[] = []

    storage.findProvenTxs = jest.fn(async ({ partial }: any) => {
      activeProvenLookups++
      maxActiveProvenLookups = Math.max(maxActiveProvenLookups, activeProvenLookups)
      await delay(10)
      activeProvenLookups--
      if (partial.txid === 'already') return [{ txid: 'already' }]
      return []
    })
    storage.findProvenTxReqs = jest.fn(async ({ partial }: any) => {
      const req = readyReqs.get(partial.txid)
      return req == null ? [] : [req]
    })
    storage.mergeReqToBeefToShareExternally = jest.fn(async (req: any) => {
      mergedTxids.push(req.txid)
    })

    const result = await storage.getReqsAndBeefToShareWithWorld(
      ['ready-1', 'already', 'missing', 'ready-2'],
      []
    )

    expect(maxActiveProvenLookups).toBeGreaterThan(1)
    expect(result.details.map((d: any) => ({ txid: d.txid, status: d.status }))).toEqual([
      { txid: 'ready-1', status: 'readyToSend' },
      { txid: 'already', status: 'alreadySent' },
      { txid: 'missing', status: 'error' },
      { txid: 'ready-2', status: 'readyToSend' }
    ])
    expect(result.details[2].error).toContain('ERR_UNKNOWN_TXID')
    expect(mergedTxids).toEqual(['ready-1', 'ready-2'])
  })
})

function makeReq (provenTxReqId: number, txid: string): any {
  const now = new Date()
  return {
    provenTxReqId,
    created_at: now,
    updated_at: now,
    txid,
    status: 'unsent',
    rawTx: [1],
    inputBEEF: [2],
    history: '{}',
    notify: '{}',
    attempts: 0,
    notified: false
  }
}

async function delay (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
