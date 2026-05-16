import { Knex, knex as makeKnex } from 'knex'
import { Chain } from '../../../sdk'
import { ChaintracksOptions } from './Api/ChaintracksApi'
import { ChaintracksStorageKnex, ChaintracksStorageKnexOptions } from './Storage/ChaintracksStorageKnex'
import { ChaintracksFetch } from './util/ChaintracksFetch'
import { ChaintracksFetchApi } from './Api/ChaintracksFetchApi'
import { BulkFileDataManager, BulkFileDataManagerOptions } from './util/BulkFileDataManager'
import { buildChaintracksOptionsWithIngestors } from './configureChaintracksIngestors'

/**
 *
 * @param chain
 * @param rootFolder defaults to "./data/"
 * @returns
 */
export function createDefaultKnexChaintracksOptions (
  chain: Chain,
  _rootFolder: string = './data/',
  knexConfig?: Knex.Config,
  whatsonchainApiKey: string = '',
  maxPerFile: number = 100000,
  maxRetained: number = 2,
  fetch?: ChaintracksFetchApi,
  cdnUrl: string = 'https://cdn.projectbabbage.com/blockheaders/',
  liveHeightThreshold: number = 2000,
  reorgHeightThreshold: number = 400,
  bulkMigrationChunkSize: number = 500,
  batchInsertLimit: number = 400,
  addLiveRecursionLimit: number = 36
): ChaintracksOptions {
  fetch ??= new ChaintracksFetch()

  const bfo: BulkFileDataManagerOptions = {
    chain,
    fetch,
    maxPerFile,
    maxRetained,
    fromKnownSourceUrl: cdnUrl
  }
  const bulkFileDataManager = new BulkFileDataManager(bfo)

  if (knexConfig == null) throw new Error('createDefaultKnexChaintracksOptions requires knexConfig; embedded file storage has been removed.')
  const knexInstance = makeKnex(knexConfig)

  const so: ChaintracksStorageKnexOptions = {
    chain,
    knex: knexInstance,
    bulkFileDataManager,
    liveHeightThreshold,
    reorgHeightThreshold,
    bulkMigrationChunkSize,
    batchInsertLimit
  }
  const storage = new ChaintracksStorageKnex(so)

  return buildChaintracksOptionsWithIngestors(
    { chain, whatsonchainApiKey, maxPerFile, fetch, cdnUrl, addLiveRecursionLimit },
    storage
  )
}
