import { ListOutputsResult, Validation } from '@bsv/sdk'
import { StorageProvider } from '../StorageProvider'
import { AuthId } from '../../sdk/WalletStorage.interfaces'
import { TableOutput } from '../schema/tables/TableOutput'
import { specOpInvalidChange, specOpSetWalletChangeParams, specOpWalletBalance } from '../../sdk/types'
import { verifyId, verifyInteger, verifyOne } from '../../utility/utilityHelpers'
import { WERR_INVALID_PARAMETER } from '../../sdk/WERR_errors'
import pLimit from 'p-limit'

export interface ListOutputsSpecOp {
  name: string
  useBasket?: string
  ignoreLimit?: boolean
  includeOutputScripts?: boolean
  includeSpent?: boolean
  /**
   * If true, and supported by storage, maximum performance optimization, computing balance done in the query itself.
   */
  totalOutputsIsSumOfSatoshis?: boolean
  resultFromTags?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: Validation.ValidListOutputsArgs,
    specOpTags: string[]
  ) => Promise<ListOutputsResult>
  resultFromOutputs?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: Validation.ValidListOutputsArgs,
    specOpTags: string[],
    outputs: TableOutput[]
  ) => Promise<ListOutputsResult>
  filterOutputs?: (
    s: StorageProvider,
    auth: AuthId,
    vargs: Validation.ValidListOutputsArgs,
    specOpTags: string[],
    outputs: TableOutput[]
  ) => Promise<TableOutput[]>
  /**
   * undefined to intercept no tags from vargs,
   * empty array to intercept all tags,
   * or an explicit array of tags to intercept.
   */
  tagsToIntercept?: string[]
  /**
   * How many positional tags to intercept.
   */
  tagsParamsCount?: number
}

const INVALID_CHANGE_MAX_CONCURRENCY = 12

const getBasketToSpecOp: () => Record<string, ListOutputsSpecOp> = () => {
  return {
    [specOpWalletBalance]: {
      name: 'totalOutputsIsWalletBalance',
      useBasket: 'default',
      ignoreLimit: true,
      totalOutputsIsSumOfSatoshis: true,
      resultFromOutputs: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: Validation.ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[]
      ): Promise<ListOutputsResult> => {
        let totalOutputs = 0
        for (const o of outputs) totalOutputs += o.satoshis
        return { totalOutputs, outputs: [] }
      }
    },
    [specOpInvalidChange]: {
      name: 'invalidChangeOutputs',
      useBasket: 'default',
      ignoreLimit: true,
      includeOutputScripts: true,
      includeSpent: false,
      tagsToIntercept: ['release', 'all'],
      filterOutputs: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: Validation.ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[]
      ): Promise<TableOutput[]> => {
        const invalidOutputIds = new Set<number>()
        const services = s.getServices()
        const checkLimit = pLimit(INVALID_CHANGE_MAX_CONCURRENCY)
        await Promise.all(outputs.map(o => checkLimit(async () => {
          if (!o.basketId) return // only care about outputs assigned to baskets.
          await s.validateOutputScript(o)
          let ok: boolean | undefined = false
          if ((o.lockingScript != null) && o.lockingScript.length > 0) {
            ok = await services.isUtxo(o, specOpTags.includes('release'))
          } else {
            ok = undefined
          }
          if (ok === false) {
            invalidOutputIds.add(o.outputId)
          }
        })))
        const filteredOutputs = outputs.filter(o => invalidOutputIds.has(o.outputId))
        if (specOpTags.includes('release')) {
          const releaseLimit = pLimit(INVALID_CHANGE_MAX_CONCURRENCY)
          await Promise.all(filteredOutputs.map(o => releaseLimit(async () => {
            await s.updateOutput(o.outputId, { spendable: false, cacheUpdatedAt: new Date() })
            o.spendable = false
          })))
        }
        return filteredOutputs
      }
    },
    [specOpSetWalletChangeParams]: {
      name: 'setWalletChangeParams',
      tagsParamsCount: 2,
      resultFromTags: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: Validation.ValidListOutputsArgs,
        specOpTags: string[]
      ): Promise<ListOutputsResult> => {
        if (specOpTags.length !== 2) { throw new WERR_INVALID_PARAMETER('numberOfDesiredUTXOs and minimumDesiredUTXOValue', 'valid') }
        const numberOfDesiredUTXOs: number = verifyInteger(Number(specOpTags[0]))
        const minimumDesiredUTXOValue: number = verifyInteger(Number(specOpTags[1]))
        const basket = verifyOne(
          await s.findOutputBaskets({
            partial: { userId: verifyId(auth.userId), name: 'default' }
          })
        )
        await s.updateOutputBasket(basket.basketId, {
          numberOfDesiredUTXOs,
          minimumDesiredUTXOValue
        })
        return { totalOutputs: 0, outputs: [] }
      }
    }
  }
}

const getTagToSpecOp: () => Record<string, ListOutputsSpecOp> = () => {
  return {
    [specOpWalletBalance]: {
      name: 'totalOutputsIsWalletBalance',
      useBasket: 'default',
      ignoreLimit: true,
      totalOutputsIsSumOfSatoshis: true,
      resultFromOutputs: async (
        s: StorageProvider,
        auth: AuthId,
        vargs: Validation.ValidListOutputsArgs,
        specOpTags: string[],
        outputs: TableOutput[]
      ): Promise<ListOutputsResult> => {
        let totalOutputs = 0
        for (const o of outputs) totalOutputs += o.satoshis
        return { totalOutputs, outputs: [] }
      }
    }
  }
}

let _basketSpecOps: Record<string, ListOutputsSpecOp> | undefined
let _tagSpecOps: Record<string, ListOutputsSpecOp> | undefined

/**
 * Check basket and tags arguments passed to listOutputs to determine if they trigger a special operation execution mode.
 * @param basket
 * @param tags
 * @returns
 */
export function getListOutputsSpecOp (
  basket: string,
  tags: string[]
): { specOp: ListOutputsSpecOp | undefined, basket?: string, tags: string[] } {
  let specOp: ListOutputsSpecOp | undefined
  if (basket) {
    _basketSpecOps ??= getBasketToSpecOp()
    specOp = _basketSpecOps[basket]
    if (specOp) {
      return { specOp, basket: specOp.useBasket, tags: tags || [] }
    }
  }
  if (tags) {
    _tagSpecOps ??= getTagToSpecOp()
    for (const tag of tags) {
      specOp = _tagSpecOps[tag]
      if (specOp) {
        if (!basket && specOp.useBasket) basket = specOp.useBasket
        return { specOp, basket, tags: tags.filter(t => t !== tag) }
      }
    }
  }
  return { specOp: undefined, basket, tags }
}
