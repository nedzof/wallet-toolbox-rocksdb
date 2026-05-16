import { HttpClient } from '@bsv/sdk'
import { Chain } from '../../../sdk/types'
import { asString } from '../../../utility/utilityHelpers.noBuffer'
import { BaseBlockHeader, BlockHeader } from './Api/BlockHeaderApi'
import { ChaintracksClientApi, ChaintracksInfoApi, HeaderListener, ReorgListener } from './Api/ChaintracksClientApi'
import { createUndiciHttpClient } from '../../../http/UndiciHttpClient'

interface FetchStatus<T> {
  status: 'success' | 'error'
  code?: string
  description?: string
  value?: T
}

export interface ChaintracksServiceClientOptions {
  useAuthrite?: boolean
  httpClient?: HttpClient
}

/**
 * Connects to a ChaintracksService to implement 'ChaintracksClientApi'
 *
 */
export class ChaintracksServiceClient implements ChaintracksClientApi {
  static createChaintracksServiceClientOptions (): ChaintracksServiceClientOptions {
    const options: ChaintracksServiceClientOptions = {
      useAuthrite: false
    }
    return options
  }

  options: ChaintracksServiceClientOptions
  httpClient: HttpClient

  constructor (
    public chain: Chain,
    public serviceUrl: string,
    options?: ChaintracksServiceClientOptions
  ) {
    this.options = options || ChaintracksServiceClient.createChaintracksServiceClientOptions()
    this.httpClient = this.options.httpClient ?? createUndiciHttpClient()
  }

  async subscribeHeaders (listener: HeaderListener): Promise<string> {
    throw new Error('Method not implemented.')
  }

  async subscribeReorgs (listener: ReorgListener): Promise<string> {
    throw new Error('Method not implemented.')
  }

  async unsubscribe (subscriptionId: string): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  async currentHeight (): Promise<number> {
    return await this.getPresentHeight()
  }

  async isValidRootForHeight (root: string, height: number): Promise<boolean> {
    const r = await this.findHeaderForHeight(height)
    if (r == null) return false
    const isValid = root === asString(r.merkleRoot)
    return isValid
  }

  async getJsonOrUndefined<T>(path: string): Promise<T | undefined> {
    let e: Error | undefined
    for (let retry = 0; retry < 3; retry++) {
      try {
        const r = await this.httpClient.request<FetchStatus<T>>(`${this.serviceUrl}${path}`, { method: 'GET' })
        if (!r.ok) throw new Error(JSON.stringify(r))
        const v = r.data
        if (v.status === 'success') return v.value
        else e = new Error(JSON.stringify(v))
      } catch (error_: unknown) {
        e = error_ as Error
      }
      if (e && e.name !== 'ECONNRESET') break
    }
    if (e != null) throw e
  }

  async getJson<T>(path: string): Promise<T> {
    const r = await this.getJsonOrUndefined<T>(path)
    if (r === undefined) throw new Error('Value was undefined. Requested object may not exist.')
    return r
  }

  async postJsonVoid<T>(path: string, params: T): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const r = await this.httpClient.request<FetchStatus<void>, T>(`${this.serviceUrl}${path}`, {
      method: 'POST',
      headers,
      data: params
    })
    try {
      const s = r.data
      if (s.status === 'success') return
      throw new Error(JSON.stringify(s))
    } catch (e) {
      console.log(`Exception: ${JSON.stringify(e)}`)
      throw new Error(JSON.stringify(e))
    }
  }

  //
  // HTTP API FUNCTIONS
  //

  async addHeader (header: BaseBlockHeader): Promise<void> {
    const r = await this.postJsonVoid('/addHeaderHex', header)
    if (typeof r === 'string') throw new Error(r)
  }

  async startListening (): Promise<void> {
    await this.getPresentHeight()
  }

  async listening (): Promise<void> {
    await this.getPresentHeight()
  }

  async getChain (): Promise<Chain> {
    return this.chain
  }

  async isListening (): Promise<boolean> {
    try {
      await this.getPresentHeight()
      return true
    } catch {
      return false
    }
  }

  async isSynchronized (): Promise<boolean> {
    return await this.isListening()
  }

  async getPresentHeight (): Promise<number> {
    return await this.getJson('/getPresentHeight')
  }

  async getInfo (): Promise<ChaintracksInfoApi> {
    return await this.getJson('/getInfo')
  }

  async findChainTipHeader (): Promise<BlockHeader> {
    return await this.getJson('/findChainTipHeaderHex')
  }

  async findChainTipHash (): Promise<string> {
    return await this.getJson('/findChainTipHashHex')
  }

  async getHeaders (height: number, count: number): Promise<string> {
    return await this.getJson<string>(`/getHeaders?height=${height}&count=${count}`)
  }

  async findHeaderForHeight (height: number): Promise<BlockHeader | undefined> {
    return await this.getJsonOrUndefined(`/findHeaderHexForHeight?height=${height}`)
  }

  async findHeaderForBlockHash (hash: string): Promise<BlockHeader | undefined> {
    return await this.getJsonOrUndefined(`/findHeaderHexForBlockHash?hash=${hash}`)
  }
}
