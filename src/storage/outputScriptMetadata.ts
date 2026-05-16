import { Utils } from '@bsv/sdk'
import { sha256Hash } from '../utility/utilityHelpers'
import { TableOutput } from './schema/tables/TableOutput'

export function hashOutputLockingScript (lockingScript: number[]): string {
  return Utils.toHex(sha256Hash(lockingScript))
}

export function applyOutputScriptMetadata<T extends Partial<TableOutput>> (output: T): T {
  if (output.lockingScript == null || output.lockingScript.length === 0) return output
  output.scriptHash = hashOutputLockingScript(output.lockingScript)
  return output
}
