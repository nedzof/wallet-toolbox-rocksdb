import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'
import { summarizePostBeefProviderAttemptsForTxid } from '../../src/storage/methods/attemptToPostReqsToNetwork'

describe('attemptToPostReqsToNetwork broadcast history', () => {
  test('summarizes every provider attempt for a txid', () => {
    const pbrs: PostBeefResult[] = [
      {
        name: 'arc',
        status: 'success',
        txidResults: [
          { txid: 'txid1', status: 'success' },
          { txid: 'txid2', status: 'success', alreadyKnown: true }
        ]
      },
      {
        name: 'woc',
        status: 'error',
        txidResults: [
          { txid: 'txid1', status: 'error', serviceError: true }
        ]
      },
      {
        name: 'bitails:main',
        status: 'error',
        txidResults: [
          { txid: 'txid1', status: 'error', doubleSpend: true }
        ]
      },
      {
        name: 'local-policy',
        status: 'error',
        txidResults: [
          { txid: 'txid1', status: 'error' }
        ]
      }
    ]

    expect(summarizePostBeefProviderAttemptsForTxid('txid1', pbrs)).toEqual([
      'arc=success/accepted',
      'woc=error/serviceError',
      'bitails%3Amain=error/doubleSpend',
      'local-policy=error/rejected'
    ])
    expect(summarizePostBeefProviderAttemptsForTxid('txid2', pbrs)).toEqual([
      'arc=success/alreadyKnown'
    ])
  })
})
