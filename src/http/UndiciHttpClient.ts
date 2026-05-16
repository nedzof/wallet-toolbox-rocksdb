import { HttpClient, HttpClientRequestOptions, HttpClientResponse } from '@bsv/sdk'
import { STATUS_CODES } from 'http'
import { Pool } from 'undici'

const walletToolboxOwnedHttpClients = new WeakSet<object>()

export interface UndiciHttpClientOptions {
  connections?: number
  pipelining?: number
  allowH2?: boolean
  keepAliveTimeout?: number
  keepAliveMaxTimeout?: number
  keepAliveTimeoutThreshold?: number
}

/**
 * SDK HttpClient adapter backed by one undici Pool per origin.
 */
export class UndiciHttpClient implements HttpClient {
  private readonly pools = new Map<string, Pool>()
  private readonly connections: number
  private readonly pipelining: number
  private readonly allowH2: boolean
  private readonly keepAliveTimeout?: number
  private readonly keepAliveMaxTimeout?: number
  private readonly keepAliveTimeoutThreshold?: number

  constructor (options: UndiciHttpClientOptions = {}) {
    this.connections = options.connections ?? 50
    this.pipelining = options.pipelining ?? 10
    this.allowH2 = options.allowH2 ?? true
    this.keepAliveTimeout = options.keepAliveTimeout
    this.keepAliveMaxTimeout = options.keepAliveMaxTimeout
    this.keepAliveTimeoutThreshold = options.keepAliveTimeoutThreshold
  }

  async request<T = any, D = any> (
    url: string,
    options: HttpClientRequestOptions<D>
  ): Promise<HttpClientResponse<T>> {
    const target = new URL(url)
    const body = serializeRequestBody(options.data)
    const response = await this.poolFor(target).request({
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers: options.headers,
      body,
      signal: options.signal
    })

    const data = await this.readBody<T>(response.body, response.headers)
    const statusText = STATUS_CODES[response.statusCode] ?? String(response.statusCode)

    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText,
      data
    } as HttpClientResponse<T>
  }

  async close (): Promise<void> {
    await Promise.all(Array.from(this.pools.values()).map(async pool => await pool.close()))
    this.pools.clear()
  }

  async download (url: string, options: { headers?: Record<string, string>, signal?: AbortSignal } = {}): Promise<Uint8Array> {
    const target = new URL(url)
    const response = await this.poolFor(target).request({
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: options.headers,
      signal: options.signal
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const statusText = STATUS_CODES[response.statusCode] ?? String(response.statusCode)
      throw new Error(`Failed to download from ${url}: ${statusText}`)
    }
    return await response.body.bytes()
  }

  private poolFor (target: URL): Pool {
    const origin = target.origin
    let pool = this.pools.get(origin)
    if (pool == null) {
      pool = new Pool(origin, {
        connections: this.connections,
        pipelining: this.pipelining,
        allowH2: this.allowH2,
        keepAliveTimeout: this.keepAliveTimeout,
        keepAliveMaxTimeout: this.keepAliveMaxTimeout,
        keepAliveTimeoutThreshold: this.keepAliveTimeoutThreshold
      })
      this.pools.set(origin, pool)
    }
    return pool
  }

  private async readBody<T> (
    body: { json: () => Promise<unknown>, text: () => Promise<string> },
    headers: Record<string, string | string[] | undefined>
  ): Promise<T> {
    const contentType = headerValue(headers['content-type'])
    if (contentType.includes('application/json')) return await body.json() as T
    return await body.text() as T
  }
}

export function createUndiciHttpClient (options?: UndiciHttpClientOptions): UndiciHttpClient {
  return new UndiciHttpClient(options)
}

export function markWalletToolboxOwnedHttpClient<T extends object> (client: T): T {
  walletToolboxOwnedHttpClients.add(client)
  return client
}

export function isWalletToolboxOwnedHttpClient (client: unknown): boolean {
  return typeof client === 'object' && client !== null && walletToolboxOwnedHttpClients.has(client)
}

function serializeRequestBody (data: unknown): string | Uint8Array | undefined {
  if (data === undefined) return undefined
  if (typeof data === 'string') return data
  if (data instanceof Uint8Array) return data
  return JSON.stringify(data)
}

function headerValue (value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',').toLowerCase() : String(value ?? '').toLowerCase()
}
