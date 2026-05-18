import * as sdk from '../../sdk'
import { StorageIdb } from '../StorageIdb'

const provenTxReqStatusesSafeForInputRestore: sdk.ProvenTxReqStatus[] = ['invalid', 'doubleSpend']

/**
 * Looks for unpropagated state:
 *
 * 1. set transactions to 'failed' if not already failed and provenTxReq with matching txid has status of 'invalid'.
 * 2. sets outputs to spendable true, spentBy undefined if spentBy is a transaction with status 'failed'
 *    and no live ProvenTxReq can still reconcile the transaction.
 * 3. sets transactions to 'completed' if provenTx with matching txid exists and current provenTxId is null.
 *
 * @param storage
 * @param args
 * @returns
 */
export async function reviewStatusIdb (
  storage: StorageIdb,
  args: { agedLimit: Date, trx?: sdk.TrxToken }
): Promise<{ log: string }> {
  const r: { log: string } = { log: '' }

  // 1. set transactions to 'failed' if not already failed and provenTxReq with matching txid has status of 'invalid'.
  const invalidTxids: string[] = []
  await storage.filterProvenTxReqs({ partial: { status: 'invalid' } }, txReq => {
    invalidTxids.push(txReq.txid)
  })
  for (const txid of invalidTxids) {
    const txs = await storage.findTransactions({ partial: { txid } })
    for (const tx of txs) {
      if (tx.status !== 'failed') {
        r.log += `transaction ${tx.transactionId} updated to status of 'failed' was ${tx.status}\n`
        await storage.updateTransactionStatus('failed', tx.transactionId)
      }
    }
  }

  // 2. restore inputs only when a failed transaction has no live/reconcilable ProvenTxReq.
  const failedTxs = await storage.findTransactions({ partial: { status: 'failed' }, noRawTx: true })
  for (const tx of failedTxs) {
    if (tx.txid == null) continue
    const reqs = await storage.findProvenTxReqs({ partial: { txid: tx.txid } })
    if (reqs.some(req => !provenTxReqStatusesSafeForInputRestore.includes(req.status))) continue

    const outputs = await storage.findOutputs({ partial: {}, noScript: true })
    for (const output of outputs) {
      if (output.spentBy !== tx.transactionId) continue
      if (output.spendable === true && output.spentBy == null) continue
      r.log += `output ${output.outputId} restored to spendable where spentBy is failed transaction ${tx.transactionId}\n`
      await storage.updateOutput(output.outputId, { spendable: true, spentBy: undefined })
    }
  }

  // 3. mark transactions completed when a matching ProvenTx exists.
  const txs = await storage.findTransactions({ partial: {}, noRawTx: true })
  for (const tx of txs) {
    if (tx.provenTxId != null || tx.txid == null) continue
    const proven = await storage.findProvenTxs({ partial: { txid: tx.txid } })
    const ptx = proven[0]
    if (ptx == null) continue
    r.log += `transaction ${tx.transactionId} updated with provenTxId ${ptx.provenTxId} and status of 'completed'\n`
    await storage.updateTransaction(tx.transactionId, { status: 'completed', provenTxId: ptx.provenTxId })
  }

  return r
}
