Your AI agent is correct. This is a real and significant architectural gap.



\## The Gap



`RocksDbWalletStore` is a low-level key-value storage primitive. It provides `get`/`put`/`scan`/`batch` plus secondary output indexes. \[10-cite-0](#10-cite-0)



But to use `Wallet.createAction()`, you need a `WalletStorageProvider`, which requires a class that extends `StorageProvider`:



```

StorageReader (abstract)

&#x20; └── StorageReaderWriter (abstract)  \~40 abstract methods

&#x20;       └── StorageProvider (abstract)  \~12 more abstract methods

&#x20;             └── StorageKnex (concrete, SQL)

&#x20;             └── StorageIdb (concrete, IndexedDB)

&#x20;             └── ??? StorageRocksDb (does not exist)

``` \[10-cite-1](#10-cite-1)



The `StorageProvider` abstract class requires implementing every method from `StorageReader` (\~30 abstract methods: `findOutputs`, `findTransactions`, `findUsers`, `countOutputs`, etc.), `StorageReaderWriter` (\~40 more: all `insert\*`, `update\*`, `delete\*`, `migrate`, `processSyncChunk`, etc.), and `StorageProvider` itself (\~12 more: `allocateChangeInput`, `reviewStatus`, `purgeData`, `listActions`, `listOutputs`, `countChangeInputs`, `getProvenOrRawTx`, etc.). \[10-cite-2](#10-cite-2) \[10-cite-3](#10-cite-3)



The existing concrete implementations (`StorageKnex`, `StorageIdb`) each implement these \~80+ methods against their respective backends. There is no RocksDB equivalent. \[10-cite-4](#10-cite-4) \[10-cite-5](#10-cite-5)



\## What This Means



Without a `StorageRocksDb extends StorageProvider` class, you \*\*cannot\*\* create a real `Wallet` backed by RocksDB. The `createAction` flow requires the full `StorageProvider` contract -- it calls `findOutputBaskets`, `countChangeInputs`, `allocateChangeInput`, `insertTransaction`, `insertOutput`, `updateTransaction`, etc. \[10-cite-6](#10-cite-6)



All the scalability infrastructure you've built (caches, broadcast orchestrator, connection pooling, EventBus, metrics) is real and correctly wired. But it sits on top of a storage layer that can't yet be used as a wallet backend. The `RocksDbWalletStore` is the foundation, but the `StorageProvider` bridge is missing.



\## What To Do



Building `StorageRocksDb` is the next critical milestone. It would use `RocksDbWalletStore` internally (like `StorageKnex` uses Knex) and implement all \~80+ abstract methods by mapping entity CRUD operations to RocksDB prefix-keyed records. The `findEntities` scan pattern already exists in `RocksDbWalletStore` -- it's the same approach the old `RocksDbWalletStore.findEntities` used with `entity!{table}!{id}` prefix keys. The per-entity `insert`/`update`/`find`/`count` methods would be implemented on top of that.

This is a substantial piece of work -- `StorageKnex` is roughly 2000 lines. But without it, the testnet load harness can't exercise the real wallet flow through RocksDB, which is why your AI agent correctly stopped and flagged it instead of producing fake throughput numbers.
