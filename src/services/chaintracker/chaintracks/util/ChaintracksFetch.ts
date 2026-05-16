import { HttpClient } from '@bsv/sdk'
import { ChaintracksFetchApi } from '../Api/ChaintracksFetchApi'
import { wait } from '../../../../utility/utilityHelpers'
import { createUndiciHttpClient, UndiciHttpClient } from '../../../../http/UndiciHttpClient'

/**
 * This class implements the ChaintracksFetchApi
 * using a pooled undici-backed HTTP client.
 */
export class ChaintracksFetch implements ChaintracksFetchApi {
  httpClient: HttpClient & Pick<UndiciHttpClient, 'download'> = createUndiciHttpClient()

  async download (url: string): Promise<Uint8Array> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.httpClient.download(url, {
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        })
      } catch (e: any) {
        if (String(e?.message ?? '').includes('Too Many Requests') && retry < 3) {
          // WhatsOnChain rate limits requests, so backoff and retry
          await wait(1000 * (retry + 1))
          continue
        }
        throw e
      }
    }
  }

  async fetchJson<R>(url: string): Promise<R> {
    const requestJsonOptions = {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
    let json: R
    for (let retry = 0; ; retry++) {
      const response = await this.httpClient.request<R>(url, requestJsonOptions)
      if (!response.ok) {
        if (response.statusText === 'Too Many Requests' && retry < 3) {
          await wait(1000 * (retry + 1))
          continue
        }
        throw new Error(`Failed to fetch JSON from ${url}: ${response.statusText}`)
      }
      json = response.data
      break
    }
    return json
  }

  pathJoin (baseUrl: string, subpath: string): string {
    // Ensure the subpath doesn't start with a slash to avoid issues
    const cleanSubpath = subpath.replace(/^\/+/, '')
    if (!baseUrl.endsWith('/')) baseUrl += '/'
    // Create a new URL object and append the subpath
    const url = new URL(cleanSubpath, baseUrl)
    return url.toString()
  }
}
