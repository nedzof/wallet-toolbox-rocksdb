/**
 * WABClient
 *
 * Provides high-level methods to:
 *  - Retrieve server info (supported auth methods, faucet info)
 *  - Generate a random presentation key
 *  - Start/Complete authentication with a chosen AuthMethodInteractor
 *  - Link/unlink methods
 *  - Request faucet
 *  - Delete user
 */
import { AuthMethodInteractor } from './auth-method-interactors/AuthMethodInteractor'
import { PrivateKey } from '@bsv/sdk'
import { createUndiciHttpClient, UndiciHttpClient } from '../http/UndiciHttpClient'

export class WABClient {
  constructor (
    private readonly serverUrl: string,
    private readonly httpClient: Pick<UndiciHttpClient, 'request'> = createUndiciHttpClient()
  ) {}

  /**
   * Return the WAB server info
   */
  public async getInfo () {
    return await this.requestJson('/info')
  }

  /**
   * Generate a random 256-bit presentation key as a hex string (client side).
   */
  public generateRandomPresentationKey (): string {
    return PrivateKey.fromRandom().toHex()
  }

  /**
   * Start an Auth Method flow
   */
  public async startAuthMethod (authMethod: AuthMethodInteractor, presentationKey: string, payload: any) {
    return await authMethod.startAuth(this.serverUrl, presentationKey, payload)
  }

  /**
   * Complete an Auth Method flow
   */
  public async completeAuthMethod (authMethod: AuthMethodInteractor, presentationKey: string, payload: any) {
    return await authMethod.completeAuth(this.serverUrl, presentationKey, payload)
  }

  /**
   * List user-linked methods
   */
  public async listLinkedMethods (presentationKey: string) {
    return await this.requestJson('/user/linkedMethods', { presentationKey })
  }

  /**
   * Unlink a given Auth Method by ID
   */
  public async unlinkMethod (presentationKey: string, authMethodId: number) {
    return await this.requestJson('/user/unlinkMethod', { presentationKey, authMethodId })
  }

  /**
   * Request faucet
   */
  public async requestFaucet (presentationKey: string) {
    return await this.requestJson('/faucet/request', { presentationKey })
  }

  /**
   * Delete user
   */
  public async deleteUser (presentationKey: string) {
    return await this.requestJson('/user/delete', { presentationKey })
  }

  // ============================================================
  // Shamir Share Management (2-of-3 Key Recovery System)
  // ============================================================

  /**
   * Start OTP verification for share operations
   * This initiates the auth flow (e.g., sends SMS code via Twilio)
   *
   * @param methodType The auth method type (e.g., "TwilioPhone", "DevConsole")
   * @param userIdHash SHA256 hash of the user's identity key
   * @param payload Auth method specific data (e.g., { phoneNumber: "+1..." })
   */
  public async startShareAuth (
    methodType: string,
    userIdHash: string,
    payload: any
  ): Promise<{ success: boolean, message: string }> {
    return await this.requestJson('/auth/start', {
      methodType,
      presentationKey: userIdHash, // Reuse existing auth flow with userIdHash
      payload
    })
  }

  /**
   * Store a Shamir share (Share B) on the server
   * Requires prior OTP verification via startShareAuth
   *
   * @param methodType The auth method type used for verification
   * @param payload Contains the OTP code and auth method specific data
   * @param shareB The Shamir share to store (format: x.y.threshold.integrity)
   * @param userIdHash SHA256 hash of the user's identity key
   */
  public async storeShare (
    methodType: string,
    payload: any,
    shareB: string,
    userIdHash: string
  ): Promise<{ success: boolean, message: string, userId?: number }> {
    return await this.requestJson('/share/store', {
      methodType,
      payload,
      shareB,
      userIdHash
    })
  }

  /**
   * Retrieve a Shamir share (Share B) from the server
   * Requires OTP verification
   *
   * @param methodType The auth method type used for verification
   * @param payload Contains the OTP code and auth method specific data
   * @param userIdHash SHA256 hash of the user's identity key
   */
  public async retrieveShare (
    methodType: string,
    payload: any,
    userIdHash: string
  ): Promise<{ success: boolean, shareB?: string, message: string }> {
    return await this.requestJson('/share/retrieve', {
      methodType,
      payload,
      userIdHash
    })
  }

  /**
   * Update a Shamir share (for key rotation)
   * Requires OTP verification
   *
   * @param methodType The auth method type used for verification
   * @param payload Contains the OTP code and auth method specific data
   * @param userIdHash SHA256 hash of the user's identity key
   * @param newShareB The new Shamir share to store
   */
  public async updateShare (
    methodType: string,
    payload: any,
    userIdHash: string,
    newShareB: string
  ): Promise<{ success: boolean, message: string, shareVersion?: number }> {
    return await this.requestJson('/share/update', {
      methodType,
      payload,
      userIdHash,
      newShareB
    })
  }

  /**
   * Delete a Shamir user's account and stored share
   * Requires OTP verification
   *
   * @param methodType The auth method type used for verification
   * @param payload Contains the OTP code and auth method specific data
   * @param userIdHash SHA256 hash of the user's identity key
   */
  public async deleteShamirUser (
    methodType: string,
    payload: any,
    userIdHash: string
  ): Promise<{ success: boolean, message: string }> {
    return await this.requestJson('/share/delete', {
      methodType,
      payload,
      userIdHash
    })
  }

  private async requestJson<T = any> (path: string, data?: unknown): Promise<T> {
    const response = await this.httpClient.request<T>(`${this.serverUrl}${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      data
    })
    return response.data
  }
}
