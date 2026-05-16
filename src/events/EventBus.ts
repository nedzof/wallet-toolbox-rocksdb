import EventEmitter from 'eventemitter3'

import type { BlockHeader } from '../sdk/WalletServices.interfaces'

export interface BlockEvent {
  blockHeight: number
  blockHash?: string
  timestamp: number
  header?: BlockHeader
  outpoints?: string[]
}

export interface UtxoInvalidationEvent {
  outpoints: string[]
  blockHeight?: number
}

export interface ReorgEvent {
  depth: number
  oldTip: BlockHeader
  newTip: BlockHeader
  deactivatedHeaders?: BlockHeader[]
}

export class EventBus extends EventEmitter {
  static readonly BLOCK_MINED = 'block.mined'
  static readonly UTXO_INVALIDATE = 'utxo.invalidate'
  static readonly REORG = 'reorg'

  emitBlockMined (event: BlockEvent): void {
    this.emit(EventBus.BLOCK_MINED, event)
  }

  emitUtxoInvalidation (event: UtxoInvalidationEvent): void {
    this.emit(EventBus.UTXO_INVALIDATE, event)
  }

  emitReorg (event: ReorgEvent): void {
    this.emit(EventBus.REORG, event)
  }

  onBlockMined (handler: (event: BlockEvent) => void): void {
    this.on(EventBus.BLOCK_MINED, handler)
  }

  offBlockMined (handler: (event: BlockEvent) => void): void {
    this.off(EventBus.BLOCK_MINED, handler)
  }

  onUtxoInvalidation (handler: (event: UtxoInvalidationEvent) => void): void {
    this.on(EventBus.UTXO_INVALIDATE, handler)
  }

  offUtxoInvalidation (handler: (event: UtxoInvalidationEvent) => void): void {
    this.off(EventBus.UTXO_INVALIDATE, handler)
  }

  onReorg (handler: (event: ReorgEvent) => void): void {
    this.on(EventBus.REORG, handler)
  }

  offReorg (handler: (event: ReorgEvent) => void): void {
    this.off(EventBus.REORG, handler)
  }
}
