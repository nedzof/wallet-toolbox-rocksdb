# STORAGE: BSV Wallet Toolbox API Documentation

The documentation is split into various pages, this page covers the persistent storage of wallet data: transactions, outputs and metadata.

The [WalletStorageManager](#class-walletstoragemanager) class manages a collection of storage providers of which one is the "active" storage
at any one time, and the rest are backups. It manages access to wallet data, pushing incremental updates to backups, and switching the active
to what was previously a backup.

The [StorageClient](#class-storageclient) implements a cloud based storage provider via JSON-RPC. The [StorageServer](#class-storageserver) class
and `@bsv/wallet-infra` package can be used to host such a JSON-RPC server.

The [StorageKnex](#class-storageknex) class implements `Knex` based database storage with explicit support for MySQL.

[Return To Top](./README.md)

<!--#region ts2md-api-merged-here-->
### API

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

#### Interfaces

| | | |
| --- | --- | --- |
| [AdminStatsResult](#interface-adminstatsresult) | [PostReqsToNetworkResult](#interface-postreqstonetworkresult) | [TableOutput](#interface-tableoutput) |
| [AggregatePostBeefTxResult](#interface-aggregatepostbeeftxresult) | [ProvenTxFromTxidResult](#interface-proventxfromtxidresult) | [TableOutputBasket](#interface-tableoutputbasket) |
| [CommitNewTxResults](#interface-commitnewtxresults) | [ProvenTxReqHistory](#interface-proventxreqhistory) | [TableOutputTag](#interface-tableoutputtag) |
| [EntitySyncMap](#interface-entitysyncmap) | [ProvenTxReqHistorySummaryApi](#interface-proventxreqhistorysummaryapi) | [TableOutputTagMap](#interface-tableoutputtagmap) |
| [GenerateChangeSdkChangeInput](#interface-generatechangesdkchangeinput) | [ProvenTxReqNotify](#interface-proventxreqnotify) | [TableOutputX](#interface-tableoutputx) |
| [GenerateChangeSdkChangeOutput](#interface-generatechangesdkchangeoutput) | [StorageAdminStats](#interface-storageadminstats) | [TableProvenTx](#interface-tableproventx) |
| [GenerateChangeSdkInput](#interface-generatechangesdkinput) | [StorageIdbOptions](#interface-storageidboptions) | [TableProvenTxReq](#interface-tableproventxreq) |
| [GenerateChangeSdkOutput](#interface-generatechangesdkoutput) | [StorageIdbSchema](#interface-storageidbschema) | [TableProvenTxReqDynamics](#interface-tableproventxreqdynamics) |
| [GenerateChangeSdkParams](#interface-generatechangesdkparams) | [StorageKnexOptions](#interface-storageknexoptions) | [TableSettings](#interface-tablesettings) |
| [GenerateChangeSdkResult](#interface-generatechangesdkresult) | [StorageProviderOptions](#interface-storageprovideroptions) | [TableSyncState](#interface-tablesyncstate) |
| [GenerateChangeSdkStorageChange](#interface-generatechangesdkstoragechange) | [StorageReaderOptions](#interface-storagereaderoptions) | [TableTransaction](#interface-tabletransaction) |
| [GetReqsAndBeefDetail](#interface-getreqsandbeefdetail) | [StorageReaderWriterOptions](#interface-storagereaderwriteroptions) | [TableTxLabel](#interface-tabletxlabel) |
| [GetReqsAndBeefResult](#interface-getreqsandbeefresult) | [SyncError](#interface-syncerror) | [TableTxLabelMap](#interface-tabletxlabelmap) |
| [ListActionsSpecOp](#interface-listactionsspecop) | [SyncMap](#interface-syncmap) | [TableUser](#interface-tableuser) |
| [ListOutputsSpecOp](#interface-listoutputsspecop) | [TableCertificate](#interface-tablecertificate) | [ValidateGenerateChangeSdkParamsResult](#interface-validategeneratechangesdkparamsresult) |
| [MonitorAdminContext](#interface-monitoradmincontext) | [TableCertificateField](#interface-tablecertificatefield) | [VerifyAndRepairBeefResult](#interface-verifyandrepairbeefresult) |
| [MonitorAdminContextConfig](#interface-monitoradmincontextconfig) | [TableCertificateX](#interface-tablecertificatex) | [WalletStorageServerOptions](#interface-walletstorageserveroptions) |
| [PostBeefResultForTxidApi](#interface-postbeefresultfortxidapi) | [TableCommission](#interface-tablecommission) | [WalletStorageServerRateLimitOptions](#interface-walletstorageserverratelimitoptions) |
| [PostReqsToNetworkDetails](#interface-postreqstonetworkdetails) | [TableMonitorEvent](#interface-tablemonitorevent) | [XValidCreateActionOutput](#interface-xvalidcreateactionoutput) |

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

##### Interface: AdminStatsResult

```ts
export interface AdminStatsResult extends StorageAdminStats {
    servicesStats?: ServicesCallHistory;
    monitorStats?: ServicesCallHistory;
}
```

See also: [StorageAdminStats](#interface-storageadminstats)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: AggregatePostBeefTxResult

```ts
export interface AggregatePostBeefTxResult {
    txid: string;
    txidResults: sdk.PostTxResultForTxid[];
    status: AggregateStatus;
    vreq: PostReqsToNetworkDetails;
    successCount: number;
    doubleSpendCount: number;
    statusErrorCount: number;
    serviceErrorCount: number;
    providerAttempts: string[];
    competingTxs: string[];
}
```

See also: [PostReqsToNetworkDetails](#interface-postreqstonetworkdetails)

###### Property competingTxs

Any competing double spend txids reported for this txid

```ts
competingTxs: string[]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: CommitNewTxResults

```ts
export interface CommitNewTxResults {
    req: EntityProvenTxReq;
    log?: string;
}
```

See also: [EntityProvenTxReq](#class-entityproventxreq)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: EntitySyncMap

```ts
export interface EntitySyncMap {
    entityName: string;
    idMap: Record<number, number>;
    maxUpdated_at?: Date;
    count: number;
}
```

###### Property count

The cummulative count of items of this entity type received over all the `SyncChunk`s
since the `since` was last updated.

This is the `offset` value to use for the next SyncChunk request.

```ts
count: number
```

###### Property idMap

Maps foreign ids to local ids
Some entities don't have idMaps (CertificateField, TxLabelMap and OutputTagMap)

```ts
idMap: Record<number, number>
```

###### Property maxUpdated_at

the maximum updated_at value seen for this entity over chunks received
during this udpate cycle.

```ts
maxUpdated_at?: Date
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkChangeInput

```ts
export interface GenerateChangeSdkChangeInput {
    outputId: number;
    satoshis: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkChangeOutput

```ts
export interface GenerateChangeSdkChangeOutput {
    satoshis: number;
    lockingScriptLength: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkInput

```ts
export interface GenerateChangeSdkInput {
    satoshis: number;
    unlockingScriptLength: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkOutput

```ts
export interface GenerateChangeSdkOutput {
    satoshis: number;
    lockingScriptLength: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkParams

```ts
export interface GenerateChangeSdkParams {
    fixedInputs: GenerateChangeSdkInput[];
    fixedOutputs: GenerateChangeSdkOutput[];
    feeModel: StorageFeeModel;
    targetNetCount?: number;
    changeInitialSatoshis: number;
    changeFirstSatoshis: number;
    changeLockingScriptLength: number;
    changeUnlockingScriptLength: number;
    maxChangeOutputs?: number;
    randomVals?: number[];
    noLogging?: boolean;
    log?: string;
}
```

See also: [GenerateChangeSdkInput](#interface-generatechangesdkinput), [GenerateChangeSdkOutput](#interface-generatechangesdkoutput)

###### Property changeFirstSatoshis

Lowest amount value to assign to a change output.
Drop the output if unable to satisfy.
default 285

```ts
changeFirstSatoshis: number
```

###### Property changeInitialSatoshis

Satoshi amount to initialize optional new change outputs.

```ts
changeInitialSatoshis: number
```

###### Property changeLockingScriptLength

Fixed change locking script length.

For P2PKH template, 25 bytes

```ts
changeLockingScriptLength: number
```

###### Property changeUnlockingScriptLength

Fixed change unlocking script length.

For P2PKH template, 107 bytes

```ts
changeUnlockingScriptLength: number
```

###### Property maxChangeOutputs

Maximum number of change outputs to create in this transaction.
Defaults to `maxChangeOutputsPerTransaction` (8).

Callers may override this to allow more outputs in special cases (e.g.
consolidation transactions) or fewer outputs when a compact transaction
is preferred.

```ts
maxChangeOutputs?: number
```

###### Property targetNetCount

Target for number of new change outputs added minus number of funding change outputs consumed.
If undefined, only a single change output will be added if excess fees must be recaptured.

```ts
targetNetCount?: number
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkResult

```ts
export interface GenerateChangeSdkResult {
    allocatedChangeInputs: GenerateChangeSdkChangeInput[];
    changeOutputs: GenerateChangeSdkChangeOutput[];
    size: number;
    fee: number;
    satsPerKb: number;
    maxPossibleSatoshisAdjustment?: {
        fixedOutputIndex: number;
        satoshis: number;
    };
}
```

See also: [GenerateChangeSdkChangeInput](#interface-generatechangesdkchangeinput), [GenerateChangeSdkChangeOutput](#interface-generatechangesdkchangeoutput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GenerateChangeSdkStorageChange

```ts
export interface GenerateChangeSdkStorageChange extends GenerateChangeSdkChangeInput {
    spendable: boolean;
}
```

See also: [GenerateChangeSdkChangeInput](#interface-generatechangesdkchangeinput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GetReqsAndBeefDetail

```ts
export interface GetReqsAndBeefDetail {
    txid: string;
    req?: TableProvenTxReq;
    proven?: TableProvenTx;
    status: "readyToSend" | "alreadySent" | "error" | "unknown";
    error?: string;
}
```

See also: [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: GetReqsAndBeefResult

```ts
export interface GetReqsAndBeefResult {
    beef: Beef;
    details: GetReqsAndBeefDetail[];
}
```

See also: [GetReqsAndBeefDetail](#interface-getreqsandbeefdetail)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ListActionsSpecOp

```ts
export interface ListActionsSpecOp {
    name: string;
    labelsToIntercept?: string[];
    setStatusFilter?: () => TransactionStatus[];
    postProcess?: (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListActionsArgs, specOpLabels: string[], txs: Array<Partial<TableTransaction>>) => Promise<void>;
}
```

See also: [StorageProvider](#class-storageprovider), [TableTransaction](#interface-tabletransaction)

###### Property labelsToIntercept

undefined to intercept no labels from vargs,
empty array to intercept all labels,
or an explicit array of labels to intercept.

```ts
labelsToIntercept?: string[]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ListOutputsSpecOp

```ts
export interface ListOutputsSpecOp {
    name: string;
    useBasket?: string;
    ignoreLimit?: boolean;
    includeOutputScripts?: boolean;
    includeSpent?: boolean;
    totalOutputsIsSumOfSatoshis?: boolean;
    resultFromTags?: (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListOutputsArgs, specOpTags: string[]) => Promise<ListOutputsResult>;
    resultFromOutputs?: (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListOutputsArgs, specOpTags: string[], outputs: TableOutput[]) => Promise<ListOutputsResult>;
    filterOutputs?: (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListOutputsArgs, specOpTags: string[], outputs: TableOutput[]) => Promise<TableOutput[]>;
    tagsToIntercept?: string[];
    tagsParamsCount?: number;
}
```

See also: [StorageProvider](#class-storageprovider), [TableOutput](#interface-tableoutput)

###### Property tagsParamsCount

How many positional tags to intercept.

```ts
tagsParamsCount?: number
```

###### Property tagsToIntercept

undefined to intercept no tags from vargs,
empty array to intercept all tags,
or an explicit array of tags to intercept.

```ts
tagsToIntercept?: string[]
```

###### Property totalOutputsIsSumOfSatoshis

If true, and supported by storage, maximum performance optimization, computing balance done in the query itself.

```ts
totalOutputsIsSumOfSatoshis?: boolean
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: MonitorAdminContext

```ts
export interface MonitorAdminContext {
    config: MonitorAdminContextConfig;
    daemon: MonitorDaemon;
    authWallet?: Wallet;
}
```

See also: [MonitorAdminContextConfig](#interface-monitoradmincontextconfig)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: MonitorAdminContextConfig

```ts
export interface MonitorAdminContextConfig {
    chain: sdk.Chain;
    adminPort?: number;
    adminHost: string;
    adminIdentityKeys: string[];
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: PostBeefResultForTxidApi

```ts
export interface PostBeefResultForTxidApi {
    txid: string;
    status: "success" | "error";
    alreadyKnown?: boolean;
    blockHash?: string;
    blockHeight?: number;
    merklePath?: string;
}
```

###### Property alreadyKnown

if true, the transaction was already known to this service. Usually treat as a success.

Potentially stop posting to additional transaction processors.

```ts
alreadyKnown?: boolean
```

###### Property status

'success' - The transaction was accepted for processing

```ts
status: "success" | "error"
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: PostReqsToNetworkDetails

```ts
export interface PostReqsToNetworkDetails {
    txid: string;
    req: EntityProvenTxReq;
    status: PostReqsToNetworkDetailsStatus;
    competingTxs?: string[];
}
```

See also: [EntityProvenTxReq](#class-entityproventxreq), [PostReqsToNetworkDetailsStatus](#type-postreqstonetworkdetailsstatus)

###### Property competingTxs

Any competing double spend txids reported for this txid

```ts
competingTxs?: string[]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: PostReqsToNetworkResult

```ts
export interface PostReqsToNetworkResult {
    status: "success" | "error";
    beef: Beef;
    details: PostReqsToNetworkDetails[];
    log: string;
}
```

See also: [PostReqsToNetworkDetails](#interface-postreqstonetworkdetails)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ProvenTxFromTxidResult

```ts
export interface ProvenTxFromTxidResult {
    proven?: EntityProvenTx;
    rawTx?: number[];
}
```

See also: [EntityProvenTx](#class-entityproventx)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ProvenTxReqHistory

```ts
export interface ProvenTxReqHistory {
    notes?: ReqHistoryNote[];
}
```

###### Property notes

Keys are Date().toISOString()
Values are a description of what happened.

```ts
notes?: ReqHistoryNote[]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ProvenTxReqHistorySummaryApi

```ts
export interface ProvenTxReqHistorySummaryApi {
    setToCompleted: boolean;
    setToCallback: boolean;
    setToUnmined: boolean;
    setToDoubleSpend: boolean;
    setToSending: boolean;
    setToUnconfirmed: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ProvenTxReqNotify

```ts
export interface ProvenTxReqNotify {
    transactionIds?: number[];
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageAdminStats

```ts
export interface StorageAdminStats {
    requestedBy: string;
    when: string;
    usersDay: number;
    usersWeek: number;
    usersMonth: number;
    usersTotal: number;
    transactionsDay: number;
    transactionsWeek: number;
    transactionsMonth: number;
    transactionsTotal: number;
    txCompletedDay: number;
    txCompletedWeek: number;
    txCompletedMonth: number;
    txCompletedTotal: number;
    txFailedDay: number;
    txFailedWeek: number;
    txFailedMonth: number;
    txFailedTotal: number;
    txAbandonedDay: number;
    txAbandonedWeek: number;
    txAbandonedMonth: number;
    txAbandonedTotal: number;
    txUnprocessedDay: number;
    txUnprocessedWeek: number;
    txUnprocessedMonth: number;
    txUnprocessedTotal: number;
    txSendingDay: number;
    txSendingWeek: number;
    txSendingMonth: number;
    txSendingTotal: number;
    txUnprovenDay: number;
    txUnprovenWeek: number;
    txUnprovenMonth: number;
    txUnprovenTotal: number;
    txUnsignedDay: number;
    txUnsignedWeek: number;
    txUnsignedMonth: number;
    txUnsignedTotal: number;
    txNosendDay: number;
    txNosendWeek: number;
    txNosendMonth: number;
    txNosendTotal: number;
    txNonfinalDay: number;
    txNonfinalWeek: number;
    txNonfinalMonth: number;
    txNonfinalTotal: number;
    txUnfailDay: number;
    txUnfailWeek: number;
    txUnfailMonth: number;
    txUnfailTotal: number;
    satoshisDefaultDay: number;
    satoshisDefaultWeek: number;
    satoshisDefaultMonth: number;
    satoshisDefaultTotal: number;
    satoshisOtherDay: number;
    satoshisOtherWeek: number;
    satoshisOtherMonth: number;
    satoshisOtherTotal: number;
    basketsDay: number;
    basketsWeek: number;
    basketsMonth: number;
    basketsTotal: number;
    labelsDay: number;
    labelsWeek: number;
    labelsMonth: number;
    labelsTotal: number;
    tagsDay: number;
    tagsWeek: number;
    tagsMonth: number;
    tagsTotal: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageIdbOptions

```ts
export interface StorageIdbOptions extends StorageProviderOptions {
}
```

See also: [StorageProviderOptions](#interface-storageprovideroptions)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageIdbSchema

```ts
export interface StorageIdbSchema {
    certificates: {
        key: number;
        value: TableCertificate;
        indexes: {
            userId: number;
            userId_type_certifier_serialNumber: [
                number,
                Base64String,
                PubKeyHex,
                Base64String
            ];
        };
    };
    certificateFields: {
        key: number;
        value: TableCertificateField;
        indexes: {
            userId: number;
            certificateId: number;
        };
    };
    commissions: {
        key: number;
        value: TableCommission;
        indexes: {
            userId: number;
            transactionId: number;
        };
    };
    monitorEvents: {
        key: number;
        value: TableMonitorEvent;
    };
    outputs: {
        key: number;
        value: TableOutput;
        indexes: {
            userId: number;
            transactionId: number;
            basketId: number;
            scriptHash: string;
            userId_basketId_spendable_scriptHash: [
                number,
                number,
                boolean,
                string
            ];
            spentBy: string;
            transactionId_vout_userId: [
                number,
                number,
                number
            ];
        };
    };
    outputBaskets: {
        key: number;
        value: TableOutputBasket;
        indexes: {
            userId: number;
            name_userId: [
                string,
                number
            ];
        };
    };
    outputTags: {
        key: number;
        value: TableOutputTag;
        indexes: {
            userId: number;
            tag_userId: [
                string,
                number
            ];
        };
    };
    outputTagMaps: {
        key: number;
        value: TableOutputTagMap;
        indexes: {
            outputTagId: number;
            outputId: number;
        };
    };
    provenTxs: {
        key: number;
        value: TableProvenTx;
        indexes: {
            txid: HexString;
        };
    };
    provenTxReqs: {
        key: number;
        value: TableProvenTxReq;
        indexes: {
            provenTxId: number;
            txid: HexString;
            status: ProvenTxReqStatus;
            batch: string;
        };
    };
    syncStates: {
        key: number;
        value: TableSyncState;
        indexes: {
            userId: number;
            refNum: string;
            status: SyncStatus;
        };
    };
    settings: {
        key: number;
        value: TableSettings;
        indexes: Record<string, never>;
    };
    transactions: {
        key: number;
        value: TableTransaction;
        indexes: {
            userId: number;
            provenTxId: number;
            reference: string;
            status: TransactionStatus;
        };
    };
    txLabels: {
        key: number;
        value: TableTxLabel;
        indexes: {
            userId: number;
            label_userId: [
                string,
                number
            ];
        };
    };
    txLabelMaps: {
        key: number;
        value: TableTxLabelMap;
        indexes: {
            transactionId: number;
            txLabelId: number;
        };
    };
    users: {
        key: number;
        value: TableUser;
        indexes: {
            identityKey: string;
        };
    };
}
```

See also: [TableCertificate](#interface-tablecertificate), [TableCertificateField](#interface-tablecertificatefield), [TableCommission](#interface-tablecommission), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputTagMap](#interface-tableoutputtagmap), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate), [TableTransaction](#interface-tabletransaction), [TableTxLabel](#interface-tabletxlabel), [TableTxLabelMap](#interface-tabletxlabelmap), [TableUser](#interface-tableuser)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageKnexOptions

```ts
export interface StorageKnexOptions extends StorageProviderOptions {
    knex: Knex;
}
```

See also: [StorageProviderOptions](#interface-storageprovideroptions)

###### Property knex

Knex database interface initialized with valid connection configuration.

```ts
knex: Knex
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageProviderOptions

```ts
export interface StorageProviderOptions extends StorageReaderWriterOptions {
    chain: Chain;
    feeModel: StorageFeeModel;
    commissionSatoshis: number;
    commissionPubKeyHex?: PubKeyHex;
}
```

See also: [StorageReaderWriterOptions](#interface-storagereaderwriteroptions)

###### Property commissionPubKeyHex

If commissionSatoshis is greater than zero, must be a valid public key hex string.
The actual locking script for each commission will use a public key derived
from this key by information stored in the commissions table.

```ts
commissionPubKeyHex?: PubKeyHex
```

###### Property commissionSatoshis

Transactions created by this Storage can charge a fee per transaction.
A value of zero disables commission fees.

```ts
commissionSatoshis: number
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageReaderOptions

```ts
export interface StorageReaderOptions {
    chain: sdk.Chain;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: StorageReaderWriterOptions

```ts
export interface StorageReaderWriterOptions extends StorageReaderOptions {
}
```

See also: [StorageReaderOptions](#interface-storagereaderoptions)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: SyncError

```ts
export interface SyncError {
    code: string;
    description: string;
    stack?: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: SyncMap

```ts
export interface SyncMap {
    provenTx: EntitySyncMap;
    outputBasket: EntitySyncMap;
    transaction: EntitySyncMap;
    provenTxReq: EntitySyncMap;
    txLabel: EntitySyncMap;
    txLabelMap: EntitySyncMap;
    output: EntitySyncMap;
    outputTag: EntitySyncMap;
    outputTagMap: EntitySyncMap;
    certificate: EntitySyncMap;
    certificateField: EntitySyncMap;
    commission: EntitySyncMap;
}
```

See also: [EntitySyncMap](#interface-entitysyncmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableCertificate

```ts
export interface TableCertificate extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    certificateId: number;
    userId: number;
    type: Base64String;
    serialNumber: Base64String;
    certifier: PubKeyHex;
    subject: PubKeyHex;
    verifier?: PubKeyHex;
    revocationOutpoint: OutpointString;
    signature: HexString;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableCertificateField

```ts
export interface TableCertificateField extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    userId: number;
    certificateId: number;
    fieldName: string;
    fieldValue: string;
    masterKey: Base64String;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableCertificateX

```ts
export interface TableCertificateX extends TableCertificate {
    fields?: TableCertificateField[];
}
```

See also: [TableCertificate](#interface-tablecertificate), [TableCertificateField](#interface-tablecertificatefield)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableCommission

```ts
export interface TableCommission extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    commissionId: number;
    userId: number;
    transactionId: number;
    satoshis: number;
    keyOffset: string;
    isRedeemed: boolean;
    lockingScript: number[];
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableMonitorEvent

```ts
export interface TableMonitorEvent extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    id: number;
    event: string;
    details?: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableOutput

```ts
export interface TableOutput extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    outputId: number;
    userId: number;
    transactionId: number;
    basketId?: number;
    spendable: boolean;
    change: boolean;
    outputDescription: DescriptionString5to50Bytes;
    vout: number;
    satoshis: number;
    providedBy: sdk.StorageProvidedBy;
    purpose: string;
    type: string;
    txid?: string;
    senderIdentityKey?: PubKeyHex;
    derivationPrefix?: Base64String;
    derivationSuffix?: Base64String;
    customInstructions?: string;
    spentBy?: number;
    sequenceNumber?: number;
    spendingDescription?: string;
    scriptLength?: number;
    scriptOffset?: number;
    lockingScript?: number[];
    scriptHash?: string;
    cacheUpdatedAt?: Date;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableOutputBasket

```ts
export interface TableOutputBasket extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    basketId: number;
    userId: number;
    name: string;
    numberOfDesiredUTXOs: number;
    minimumDesiredUTXOValue: number;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableOutputTag

```ts
export interface TableOutputTag extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    outputTagId: number;
    userId: number;
    tag: string;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableOutputTagMap

```ts
export interface TableOutputTagMap extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    outputTagId: number;
    outputId: number;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableOutputX

```ts
export interface TableOutputX extends TableOutput {
    basket?: TableOutputBasket;
    tags?: TableOutputTag[];
}
```

See also: [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableProvenTx

```ts
export interface TableProvenTx extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    provenTxId: number;
    txid: string;
    height: number;
    index: number;
    merklePath: number[];
    rawTx: number[];
    blockHash: string;
    merkleRoot: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableProvenTxReq

```ts
export interface TableProvenTxReq extends TableProvenTxReqDynamics {
    created_at: Date;
    updated_at: Date;
    provenTxReqId: number;
    provenTxId?: number;
    status: sdk.ProvenTxReqStatus;
    attempts: number;
    notified: boolean;
    txid: string;
    batch?: string;
    history: string;
    notify: string;
    rawTx: number[];
    inputBEEF?: number[];
    wasBroadcast?: boolean;
    rebroadcastAttempts?: number;
}
```

See also: [TableProvenTxReqDynamics](#interface-tableproventxreqdynamics)

###### Property attempts

Count of how many times a service has been asked about this txid

```ts
attempts: number
```

###### Property batch

If valid, a unique string identifying a batch of transactions to be sent together for processing.

```ts
batch?: string
```

###### Property history

JSON string of processing history.
Parses to `ProvenTxReqHistoryApi`.

```ts
history: string
```

###### Property notified

Set to true when a terminal status has been set and notification has occurred.

```ts
notified: boolean
```

###### Property notify

JSON string of data to drive notifications when this request completes.
Parses to `ProvenTxReqNotifyApi`.

```ts
notify: string
```

###### Property rebroadcastAttempts

Count of how many times this req has been reset to 'unsent' for rebroadcast
after proof check timeout. Used by the circuit-breaker (maxRebroadcastAttempts).
Defaults to 0 (added by migration 2026-04-30-001).

```ts
rebroadcastAttempts?: number
```

###### Property wasBroadcast

Set to true the first time this req transitions to 'unmined' or 'callback' status,
indicating the transaction was successfully broadcast to the network.
Used to distinguish rebroadcast candidates from transactions that were never sent.
Defaults to false (added by migration 2026-04-30-001).

```ts
wasBroadcast?: boolean
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableProvenTxReqDynamics

Table properties that may change after initial record insertion.

```ts
export interface TableProvenTxReqDynamics extends sdk.EntityTimeStamp {
    updated_at: Date;
    provenTxId?: number;
    status: sdk.ProvenTxReqStatus;
    attempts: number;
    notified: boolean;
    batch?: string;
    history: string;
    notify: string;
    wasBroadcast?: boolean;
    rebroadcastAttempts?: number;
}
```

###### Property attempts

Count of how many times a service has been asked about this txid

```ts
attempts: number
```

###### Property batch

If valid, a unique string identifying a batch of transactions to be sent together for processing.

```ts
batch?: string
```

###### Property history

JSON string of processing history.
Parses to `ProvenTxReqHistoryApi`.

```ts
history: string
```

###### Property notified

Set to true when a terminal status has been set and notification has occurred.

```ts
notified: boolean
```

###### Property notify

JSON string of data to drive notifications when this request completes.
Parses to `ProvenTxReqNotifyApi`.

```ts
notify: string
```

###### Property rebroadcastAttempts

Count of rebroadcast cycles for this req. Used by the circuit-breaker.
Defaults to 0 (added by migration 2026-04-30-001).

```ts
rebroadcastAttempts?: number
```

###### Property wasBroadcast

Set to true the first time this req transitions to 'unmined' or 'callback' status.
Defaults to false (added by migration 2026-04-30-001).

```ts
wasBroadcast?: boolean
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableSettings

```ts
export interface TableSettings extends sdk.StorageIdentity, sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    storageIdentityKey: string;
    storageName: string;
    chain: sdk.Chain;
    dbtype: "MySQL" | "IndexedDB";
    maxOutputScript: number;
}
```

###### Property storageIdentityKey

The identity key (public key) assigned to this storage

```ts
storageIdentityKey: string
```

###### Property storageName

The human readable name assigned to this storage.

```ts
storageName: string
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableSyncState

```ts
export interface TableSyncState extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    syncStateId: number;
    userId: number;
    storageIdentityKey: string;
    storageName: string;
    status: sdk.SyncStatus;
    init: boolean;
    refNum: string;
    syncMap: string;
    when?: Date;
    satoshis?: number;
    errorLocal?: string;
    errorOther?: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableTransaction

```ts
export interface TableTransaction extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    transactionId: number;
    userId: number;
    provenTxId?: number;
    status: sdk.TransactionStatus;
    reference: Base64String;
    isOutgoing: boolean;
    satoshis: number;
    description: string;
    version?: number;
    lockTime?: number;
    txid?: string;
    inputBEEF?: number[];
    rawTx?: number[];
}
```

###### Property isOutgoing

true if transaction originated in this wallet, change returns to it.
false for a transaction created externally and handed in to this wallet.

```ts
isOutgoing: boolean
```

###### Property lockTime

Optional. Default is zero.
When the transaction can be processed into a block:
>= 500,000,000 values are interpreted as minimum required unix time stamps in seconds
< 500,000,000 values are interpreted as minimum required block height

```ts
lockTime?: number
```

###### Property reference

max length of 64, hex encoded

```ts
reference: Base64String
```

###### Property version

If not undefined, must match value in associated rawTransaction.

```ts
version?: number
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableTxLabel

```ts
export interface TableTxLabel extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    txLabelId: number;
    userId: number;
    label: string;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableTxLabelMap

```ts
export interface TableTxLabelMap extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    txLabelId: number;
    transactionId: number;
    isDeleted: boolean;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: TableUser

```ts
export interface TableUser extends sdk.EntityTimeStamp {
    created_at: Date;
    updated_at: Date;
    userId: number;
    identityKey: string;
    activeStorage: string;
}
```

###### Property activeStorage

The storageIdentityKey value of the active wallet storage.

```ts
activeStorage: string
```

###### Property identityKey

PubKeyHex uniquely identifying user.
Typically 66 hex digits.

```ts
identityKey: string
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: ValidateGenerateChangeSdkParamsResult

```ts
export interface ValidateGenerateChangeSdkParamsResult {
    hasMaxPossibleOutput?: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: VerifyAndRepairBeefResult

```ts
export interface VerifyAndRepairBeefResult {
    isStructurallyValid: boolean;
    originalRoots: Record<number, string>;
    invalidRoots: Record<number, {
        root: string;
        reproveResults: sdk.ReproveHeaderResult;
    }>;
    verifiedBeef?: Beef;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: WalletStorageServerOptions

```ts
export interface WalletStorageServerOptions {
    port: number;
    wallet: Wallet;
    monetize: boolean;
    calculateRequestPrice?: (req: Request) => number | Promise<number>;
    adminIdentityKeys?: string[];
    makeLogger?: MakeWalletLogger;
    rateLimit?: WalletStorageServerRateLimitOptions;
}
```

See also: [WalletStorageServerRateLimitOptions](#interface-walletstorageserverratelimitoptions)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: WalletStorageServerRateLimitOptions

```ts
export interface WalletStorageServerRateLimitOptions {
    maxRequests: number;
    windowMs: number;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Interface: XValidCreateActionOutput

```ts
export interface XValidCreateActionOutput extends Validation.ValidCreateActionOutput {
    vout: number;
    providedBy: StorageProvidedBy;
    purpose?: string;
    derivationSuffix?: string;
    keyOffset?: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
#### Classes

| | | |
| --- | --- | --- |
| [AdminServer](#class-adminserver) | [EntityProvenTxReq](#class-entityproventxreq) | [StorageIdb](#class-storageidb) |
| [EntityBase](#class-entitybase) | [EntitySyncState](#class-entitysyncstate) | [StorageKnex](#class-storageknex) |
| [EntityCertificate](#class-entitycertificate) | [EntityTransaction](#class-entitytransaction) | [StorageProvider](#class-storageprovider) |
| [EntityCertificateField](#class-entitycertificatefield) | [EntityTxLabel](#class-entitytxlabel) | [StorageReader](#class-storagereader) |
| [EntityCommission](#class-entitycommission) | [EntityTxLabelMap](#class-entitytxlabelmap) | [StorageReaderWriter](#class-storagereaderwriter) |
| [EntityOutput](#class-entityoutput) | [EntityUser](#class-entityuser) | [StorageServer](#class-storageserver) |
| [EntityOutputBasket](#class-entityoutputbasket) | [KnexMigrations](#class-knexmigrations) | [StorageSyncReader](#class-storagesyncreader) |
| [EntityOutputTag](#class-entityoutputtag) | [MergeEntity](#class-mergeentity) | [WalletStorageManager](#class-walletstoragemanager) |
| [EntityOutputTagMap](#class-entityoutputtagmap) | [StorageClient](#class-storageclient) |  |
| [EntityProvenTx](#class-entityproventx) | [StorageClientBase](#class-storageclientbase) |  |

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

##### Class: AdminServer

```ts
export class AdminServer {
    constructor(private readonly context: MonitorAdminContext)
    start(): void
    async close(): Promise<void>
}
```

See also: [MonitorAdminContext](#interface-monitoradmincontext)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityBase

```ts
export abstract class EntityBase<T> {
    api: T;
    constructor(api: T)
    abstract get id(): number;
    abstract get entityName(): string;
    abstract get entityTable(): string;
    abstract updateApi(): void;
    abstract equals(ei: T, syncMap?: SyncMap): boolean;
    abstract mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>;
    abstract mergeExisting(storage: EntityStorage, since: Date | undefined, ei: T, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>;
    toApi(): T
}
```

See also: [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap)

###### Method equals

Tests for equality or 'merge' / 'convergent' equality if syncMap is provided.

'convergent' equality must satisfy (A sync B) equals (B sync A)

```ts
abstract equals(ei: T, syncMap?: SyncMap): boolean
```
See also: [SyncMap](#interface-syncmap)

###### Method mergeExisting

Perform a 'merge' / 'convergent' equality migration of state
from external `ei` to this existing local EntityUser

```ts
abstract mergeExisting(storage: EntityStorage, since: Date | undefined, ei: T, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
```
See also: [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap)

Returns

true iff entity state changed and was updated to storage

###### Method mergeNew

Perform a 'merge' / 'convergent' equality migration of state
to this new local entity which was constructed
as a copy of the external object.

```ts
abstract mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
```
See also: [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap)

Argument Details

+ **userId**
  + local userId

###### Method toApi

An entity may decode properties of the underlying Api object on construction.

The `toApi` method forces an `updateApi` before returning the underlying,
now updated, Api object.

```ts
toApi(): T
```

Returns

The underlying Api object with any entity decoded properties updated.

###### Method updateApi

On construction, an entity may decode properties of the `api` object,
such as JSON stringified objects.

The `updateApi` method must re-encode the current state of those decoded properties
into the `api` object.

Used by the `toApi` method to return an updated `api` object.

```ts
abstract updateApi(): void
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityCertificate

```ts
export class EntityCertificate extends EntityBase<TableCertificate> {
    constructor(api?: TableCertificate)
    override updateApi(): void
    get certificateId()
    set certificateId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get userId()
    set userId(v: number)
    get type()
    set type(v: string)
    get subject()
    set subject(v: string)
    get verifier()
    set verifier(v: string | undefined)
    get serialNumber()
    set serialNumber(v: string)
    get certifier()
    set certifier(v: string)
    get revocationOutpoint()
    set revocationOutpoint(v: string)
    get signature()
    set signature(v: string)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableCertificate, syncMap?: SyncMap): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableCertificate, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityCertificate;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableCertificate, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableCertificate](#interface-tablecertificate)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityCertificateField

```ts
export class EntityCertificateField extends EntityBase<TableCertificateField> {
    constructor(api?: TableCertificateField)
    override updateApi(): void
    get userId()
    set userId(v: number)
    get certificateId()
    set certificateId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get fieldName()
    set fieldName(v: string)
    get fieldValue()
    set fieldValue(v: string)
    get masterKey()
    set masterKey(v: string)
    override get id(): number
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableCertificateField, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableCertificateField, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityCertificateField;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableCertificateField, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableCertificateField](#interface-tablecertificatefield)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityCommission

```ts
export class EntityCommission extends EntityBase<TableCommission> {
    constructor(api?: TableCommission)
    override updateApi(): void
    get commissionId()
    set commissionId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get transactionId()
    set transactionId(v: number)
    get userId()
    set userId(v: number)
    get isRedeemed()
    set isRedeemed(v: boolean)
    get keyOffset()
    set keyOffset(v: string)
    get lockingScript()
    set lockingScript(v: number[])
    get satoshis()
    set satoshis(v: number)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableCommission, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableCommission, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityCommission;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableCommission, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableCommission](#interface-tablecommission)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityOutput

```ts
export class EntityOutput extends EntityBase<TableOutput> {
    constructor(api?: TableOutput)
    override updateApi(): void
    get outputId()
    set outputId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get userId()
    set userId(v: number)
    get transactionId()
    set transactionId(v: number)
    get basketId()
    set basketId(v: number | undefined)
    get spentBy()
    set spentBy(v: number | undefined)
    get vout()
    set vout(v: number)
    get satoshis()
    set satoshis(v: number)
    get outputDescription()
    set outputDescription(v: string)
    get spendable()
    set spendable(v: boolean)
    get change()
    set change(v: boolean)
    get txid()
    set txid(v: string | undefined)
    get type()
    set type(v: string)
    get providedBy()
    set providedBy(v: StorageProvidedBy)
    get purpose()
    set purpose(v: string)
    get spendingDescription()
    set spendingDescription(v: string | undefined)
    get derivationPrefix()
    set derivationPrefix(v: string | undefined)
    get derivationSuffix()
    set derivationSuffix(v: string | undefined)
    get senderIdentityKey()
    set senderIdentityKey(v: string | undefined)
    get customInstructions()
    set customInstructions(v: string | undefined)
    get lockingScript()
    set lockingScript(v: number[] | undefined)
    get scriptLength()
    set scriptLength(v: number | undefined)
    get scriptOffset()
    set scriptOffset(v: number | undefined)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableOutput, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableOutput, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityOutput;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableOutput, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableOutput](#interface-tableoutput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityOutputBasket

```ts
export class EntityOutputBasket extends EntityBase<TableOutputBasket> {
    constructor(api?: TableOutputBasket)
    get basketId()
    set basketId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get userId()
    set userId(v: number)
    get name()
    set name(v: string)
    get numberOfDesiredUTXOs()
    set numberOfDesiredUTXOs(v: number)
    get minimumDesiredUTXOValue()
    set minimumDesiredUTXOValue(v: number)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id()
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override updateApi(): void
    override equals(ei: TableOutputBasket, syncMap?: SyncMap): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableOutputBasket, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityOutputBasket;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableOutputBasket, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableOutputBasket](#interface-tableoutputbasket)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityOutputTag

```ts
export class EntityOutputTag extends EntityBase<TableOutputTag> {
    constructor(api?: TableOutputTag)
    override updateApi(): void
    get outputTagId()
    set outputTagId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get tag()
    set tag(v: string)
    get userId()
    set userId(v: number)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableOutputTag, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableOutputTag, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityOutputTag;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableOutputTag, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableOutputTag](#interface-tableoutputtag)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityOutputTagMap

```ts
export class EntityOutputTagMap extends EntityBase<TableOutputTagMap> {
    constructor(api?: TableOutputTagMap)
    override updateApi(): void
    get outputTagId()
    set outputTagId(v: number)
    get outputId()
    set outputId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id(): number
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableOutputTagMap, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableOutputTagMap, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityOutputTagMap;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableOutputTagMap, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableOutputTagMap](#interface-tableoutputtagmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityProvenTx

```ts
export class EntityProvenTx extends EntityBase<TableProvenTx> {
    static async fromTxid(txid: string, services: WalletServices, rawTx?: number[]): Promise<ProvenTxFromTxidResult>
    constructor(api?: TableProvenTx)
    override updateApi(): void
    getMerklePath(): MerklePath
    _mp?: MerklePath;
    get provenTxId()
    set provenTxId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get txid()
    set txid(v: string)
    get height()
    set height(v: number)
    get index()
    set index(v: number)
    get merklePath()
    set merklePath(v: number[])
    get rawTx()
    set rawTx(v: number[])
    get blockHash()
    set blockHash(v: string)
    get merkleRoot()
    set merkleRoot(v: string)
    override get id()
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableProvenTx, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableProvenTx, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityProvenTx;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableProvenTx, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
    static readonly getProofAttemptsLimit = 8;
    static readonly getProofMinutes = 60;
    static async fromReq(req: EntityProvenTxReq, gmpResult: GetMerklePathResult, countsAsAttempt: boolean, maxRebroadcastAttempts = 0): Promise<EntityProvenTx | undefined>
}
```

See also: [EntityBase](#class-entitybase), [EntityProvenTxReq](#class-entityproventxreq), [EntityStorage](#type-entitystorage), [ProvenTxFromTxidResult](#interface-proventxfromtxidresult), [SyncMap](#interface-syncmap), [TableProvenTx](#interface-tableproventx)

###### Property getProofAttemptsLimit

How high attempts can go before status is forced to invalid

```ts
static readonly getProofAttemptsLimit = 8
```

###### Property getProofMinutes

How many hours we have to try for a poof

```ts
static readonly getProofMinutes = 60
```

###### Method fromReq

Try to create a new ProvenTx from a ProvenTxReq and GetMerkleProofResultApi

Otherwise it returns undefined and updates req.status to either 'unknown', 'invalid', or 'unconfirmed'

```ts
static async fromReq(req: EntityProvenTxReq, gmpResult: GetMerklePathResult, countsAsAttempt: boolean, maxRebroadcastAttempts = 0): Promise<EntityProvenTx | undefined>
```
See also: [EntityProvenTx](#class-entityproventx), [EntityProvenTxReq](#class-entityproventxreq)

###### Method fromTxid

Given a txid and optionally its rawTx, create a new ProvenTx object.

rawTx is fetched if not provided.

Only succeeds (proven is not undefined) if a proof is confirmed for rawTx,
and hash of rawTx is confirmed to match txid

The returned ProvenTx and ProvenTxReq objects have not been added to the storage database,
this is optional and can be done by the caller if appropriate.

```ts
static async fromTxid(txid: string, services: WalletServices, rawTx?: number[]): Promise<ProvenTxFromTxidResult>
```
See also: [ProvenTxFromTxidResult](#interface-proventxfromtxidresult)

###### Method getMerklePath

```ts
getMerklePath(): MerklePath
```

Returns

desirialized `MerklePath` object, value is cached.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityProvenTxReq

```ts
export class EntityProvenTxReq extends EntityBase<TableProvenTxReq> {
    static readonly wasBroadcastStatuses: ProvenTxReqStatus[] = ["unmined", "callback", "unconfirmed", "completed"];
    static async fromStorageTxid(storage: EntityStorage, txid: string, trx?: TrxToken): Promise<EntityProvenTxReq | undefined>
    static async fromStorageId(storage: EntityStorage, id: number, trx?: TrxToken): Promise<EntityProvenTxReq>
    static fromTxid(txid: string, rawTx: number[], inputBEEF?: number[]): EntityProvenTxReq
    history: ProvenTxReqHistory;
    notify: ProvenTxReqNotify;
    packApiHistory()
    packApiNotify()
    unpackApiHistory()
    unpackApiNotify()
    get apiHistory(): string
    get apiNotify(): string
    set apiHistory(v: string)
    set apiNotify(v: string)
    updateApi(): void
    unpackApi(): void
    async refreshFromStorage(storage: EntityStorage | WalletStorageManager, trx?: TrxToken): Promise<void>
    constructor(api?: TableProvenTxReq)
    historySince(since: Date): ProvenTxReqHistory
    historyPretty(since?: Date, indent = 0): string
    prettyNote(note: ReqHistoryNote): string
    getHistorySummary(): ProvenTxReqHistorySummaryApi
    parseHistoryNote(note: ReqHistoryNote, summary?: ProvenTxReqHistorySummaryApi): string
    addNotifyTransactionId(id: number)
    addHistoryNote(note: ReqHistoryNote, noDupes?: boolean)
    async updateStorage(storage: EntityStorage, trx?: TrxToken)
    async updateStorageDynamicProperties(storage: WalletStorageManager | StorageProvider, trx?: TrxToken)
    async insertOrMerge(storage: EntityStorage, trx?: TrxToken): Promise<EntityProvenTxReq>
    get status()
    set status(v: ProvenTxReqStatus)
    get provenTxReqId()
    set provenTxReqId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get txid()
    set txid(v: string)
    get inputBEEF()
    set inputBEEF(v: number[] | undefined)
    get rawTx()
    set rawTx(v: number[])
    get attempts()
    set attempts(v: number)
    get provenTxId()
    set provenTxId(v: number | undefined)
    get notified()
    set notified(v: boolean)
    get batch()
    set batch(v: string | undefined)
    get wasBroadcast(): boolean
    set wasBroadcast(v: boolean)
    get rebroadcastAttempts(): number
    set rebroadcastAttempts(v: number)
    applyProofTimeout(maxRebroadcastAttempts = 0): {
        action: "invalid" | "rebroadcast";
        rebroadcastAttempts: number;
    }
    override get id()
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableProvenTxReq, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableProvenTxReq, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityProvenTxReq;
        eiId: number;
    }>
    mapNotifyTransactionIds(syncMap: SyncMap): void
    mergeNotifyTransactionIds(ei: TableProvenTxReq, syncMap?: SyncMap): void
    mergeHistory(ei: TableProvenTxReq, syncMap?: SyncMap, noDupes?: boolean): void
    static isTerminalStatus(status: ProvenTxReqStatus): boolean
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableProvenTxReq, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [ProvenTxReqHistory](#interface-proventxreqhistory), [ProvenTxReqHistorySummaryApi](#interface-proventxreqhistorysummaryapi), [ProvenTxReqNotify](#interface-proventxreqnotify), [StorageProvider](#class-storageprovider), [SyncMap](#interface-syncmap), [TableProvenTxReq](#interface-tableproventxreq), [WalletStorageManager](#class-walletstoragemanager)

###### Method addHistoryNote

Adds a note to history.
Notes with identical property values to an existing note are ignored.

```ts
addHistoryNote(note: ReqHistoryNote, noDupes?: boolean)
```

Argument Details

+ **note**
  + Note to add
+ **noDupes**
  + if true, only newest note with same `what` value is retained.

###### Method equals

'convergent' equality must satisfy (A sync B) equals (B sync A)

```ts
override equals(ei: TableProvenTxReq, syncMap?: SyncMap | undefined): boolean
```
See also: [SyncMap](#interface-syncmap), [TableProvenTxReq](#interface-tableproventxreq)

###### Method historySince

Returns history to only what followed since date.

```ts
historySince(since: Date): ProvenTxReqHistory
```
See also: [ProvenTxReqHistory](#interface-proventxreqhistory)

###### Method mergeExisting

When merging `ProvenTxReq`, care is taken to avoid short-cirtuiting notification: `status` must not transition to `completed` without
passing through `notifying`. Thus a full convergent merge passes through these sequence steps:
1. Remote storage completes before local storage.
2. The remotely completed req and ProvenTx sync to local storage.
3. The local storage transitions to `notifying`, after merging the remote attempts and history.
4. The local storage notifies, transitioning to `completed`.
5. Having been updated, the local req, but not ProvenTx sync to remote storage, but do not merge because the earlier `completed` wins.
6. Convergent equality is achieved (completing work - history and attempts are equal)

On terminal failure: `doubleSpend` trumps `invalid` as it contains more data.

```ts
override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableProvenTxReq, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
```
See also: [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableProvenTxReq](#interface-tableproventxreq)

###### Method updateStorage

Updates database record with current state of this EntityUser

```ts
async updateStorage(storage: EntityStorage, trx?: TrxToken)
```
See also: [EntityStorage](#type-entitystorage)

###### Method updateStorageDynamicProperties

Update storage with changes to non-static properties:
  updated_at
  provenTxId
  status
  history
  notify
  notified
  attempts
  batch

```ts
async updateStorageDynamicProperties(storage: WalletStorageManager | StorageProvider, trx?: TrxToken)
```
See also: [StorageProvider](#class-storageprovider), [WalletStorageManager](#class-walletstoragemanager)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntitySyncState

```ts
export class EntitySyncState extends EntityBase<TableSyncState> {
    constructor(api?: TableSyncState)
    validateSyncMap(sm: SyncMap)
    static async fromStorage(storage: WalletStorageSync, userIdentityKey: string, remoteSettings: TableSettings): Promise<EntitySyncState>
    async updateStorage(storage: EntityStorage, notSyncMap?: boolean, trx?: TrxToken)
    override updateApi(notSyncMap?: boolean): void
    set created_at(v: Date)
    get created_at()
    set updated_at(v: Date)
    get updated_at()
    set userId(v: number)
    get userId()
    set storageIdentityKey(v: string)
    get storageIdentityKey()
    set storageName(v: string)
    get storageName()
    set init(v: boolean)
    get init()
    set refNum(v: string)
    get refNum()
    set status(v: SyncStatus)
    get status(): SyncStatus
    set when(v: Date | undefined)
    get when()
    set satoshis(v: number | undefined)
    get satoshis()
    get apiErrorLocal()
    get apiErrorOther()
    get apiSyncMap()
    override get id(): number
    set id(id: number)
    override get entityName(): string
    override get entityTable(): string
    static mergeIdMap(fromMap: Record<number, number>, toMap: Record<number, number>)
    mergeSyncMap(iSyncMap: SyncMap)
    errorLocal: SyncError | undefined;
    errorOther: SyncError | undefined;
    syncMap: SyncMap;
    override equals(ei: TableSyncState, syncMap?: SyncMap | undefined): boolean
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableSyncState, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
    makeRequestSyncChunkArgs(forIdentityKey: string, forStorageIdentityKey: string, maxRoughSize?: number, maxItems?: number): RequestSyncChunkArgs
    static syncChunkSummary(c: SyncChunk): string {
        let log = "";
        log += `SYNC CHUNK SUMMARY
  from storage: ${c.fromStorageIdentityKey}
  to storage: ${c.toStorageIdentityKey}
  for user: ${c.userIdentityKey}
`;
        if (c.user != null)
            log += `  USER activeStorage ${c.user.activeStorage}\n`;
        if (c.provenTxs != null) {
            log += "  PROVEN_TXS\n";
            for (const r of c.provenTxs) {
                log += `    ${r.provenTxId} ${r.txid}\n`;
            }
        }
        if (c.provenTxReqs != null) {
            log += "  PROVEN_TX_REQS\n";
            for (const r of c.provenTxReqs) {
                log += `    ${r.provenTxReqId} ${r.txid} ${r.status} ${r.provenTxId || ""}\n`;
            }
        }
        if (c.transactions != null) {
            log += "  TRANSACTIONS\n";
            for (const r of c.transactions) {
                log += `    ${r.transactionId} ${r.txid} ${r.status} ${r.provenTxId || ""} sats:${r.satoshis}\n`;
            }
        }
        if (c.outputs != null) {
            log += "  OUTPUTS\n";
            for (const r of c.outputs) {
                log += `    ${r.outputId} ${r.txid}.${r.vout} ${r.transactionId} ${r.spendable ? "spendable" : ""} sats:${r.satoshis}\n`;
            }
        }
        return log;
    }
    async processSyncChunk(writer: EntityStorage, args: RequestSyncChunkArgs, chunk: SyncChunk): Promise<{
        done: boolean;
        maxUpdated_at: Date | undefined;
        updates: number;
        inserts: number;
    }>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncError](#interface-syncerror), [SyncMap](#interface-syncmap), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate)

###### Method mergeSyncMap

Merge additions to the syncMap

```ts
mergeSyncMap(iSyncMap: SyncMap)
```
See also: [SyncMap](#interface-syncmap)

###### Method updateStorage

Handles both insert and update based on id value: zero indicates insert.

```ts
async updateStorage(storage: EntityStorage, notSyncMap?: boolean, trx?: TrxToken)
```
See also: [EntityStorage](#type-entitystorage)

Argument Details

+ **notSyncMap**
  + if not new and true, excludes updating syncMap in storage.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityTransaction

```ts
export class EntityTransaction extends EntityBase<TableTransaction> {
    getBsvTx(): BsvTransaction | undefined
    getBsvTxIns(): TransactionInput[]
    async getInputs(storage: EntityStorage, trx?: TrxToken): Promise<TableOutput[]>
    constructor(api?: TableTransaction)
    override updateApi(): void
    get transactionId()
    set transactionId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get version()
    set version(v: number | undefined)
    get lockTime()
    set lockTime(v: number | undefined)
    get isOutgoing()
    set isOutgoing(v: boolean)
    get status()
    set status(v: TransactionStatus)
    get userId()
    set userId(v: number)
    get provenTxId()
    set provenTxId(v: number | undefined)
    get satoshis()
    set satoshis(v: number)
    get txid()
    set txid(v: string | undefined)
    get reference()
    set reference(v: string)
    get inputBEEF()
    set inputBEEF(v: number[] | undefined)
    get description()
    set description(v: string)
    get rawTx()
    set rawTx(v: number[] | undefined)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableTransaction, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableTransaction, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityTransaction;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableTransaction, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
    async getProvenTx(storage: EntityStorage, trx?: TrxToken): Promise<EntityProvenTx | undefined>
}
```

See also: [EntityBase](#class-entitybase), [EntityProvenTx](#class-entityproventx), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableOutput](#interface-tableoutput), [TableTransaction](#interface-tabletransaction)

###### Method getBsvTxIns

```ts
getBsvTxIns(): TransactionInput[]
```

Returns

array of

###### Method getInputs

Returns an array of "known" inputs to this transaction which belong to the same userId.
Uses both spentBy and rawTx inputs (if available) to locate inputs from among user's outputs.
Not all transaction inputs correspond to prior storage outputs.

```ts
async getInputs(storage: EntityStorage, trx?: TrxToken): Promise<TableOutput[]>
```
See also: [EntityStorage](#type-entitystorage), [TableOutput](#interface-tableoutput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityTxLabel

```ts
export class EntityTxLabel extends EntityBase<TableTxLabel> {
    constructor(api?: TableTxLabel)
    override updateApi(): void
    get txLabelId()
    set txLabelId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get label()
    set label(v: string)
    get userId()
    set userId(v: number)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableTxLabel, syncMap?: SyncMap): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableTxLabel, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityTxLabel;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableTxLabel, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableTxLabel](#interface-tabletxlabel)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityTxLabelMap

```ts
export class EntityTxLabelMap extends EntityBase<TableTxLabelMap> {
    constructor(api?: TableTxLabelMap)
    override updateApi(): void
    get txLabelId()
    set txLabelId(v: number)
    get transactionId()
    set transactionId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get isDeleted()
    set isDeleted(v: boolean)
    override get id(): number
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableTxLabelMap, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableTxLabelMap, syncMap: SyncMap, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityTxLabelMap;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableTxLabelMap, syncMap: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableTxLabelMap](#interface-tabletxlabelmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: EntityUser

```ts
export class EntityUser extends EntityBase<TableUser> {
    constructor(api?: TableUser)
    override updateApi(): void
    get userId()
    set userId(v: number)
    get created_at()
    set created_at(v: Date)
    get updated_at()
    set updated_at(v: Date)
    get identityKey()
    set identityKey(v: string)
    get activeStorage()
    set activeStorage(v: string)
    override get id(): number
    override set id(v: number)
    override get entityName(): string
    override get entityTable(): string
    override equals(ei: TableUser, syncMap?: SyncMap | undefined): boolean
    static async mergeFind(storage: EntityStorage, userId: number, ei: TableUser, trx?: TrxToken): Promise<{
        found: boolean;
        eo: EntityUser;
        eiId: number;
    }>
    override async mergeNew(storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<void>
    override async mergeExisting(storage: EntityStorage, since: Date | undefined, ei: TableUser, syncMap?: SyncMap, trx?: TrxToken): Promise<boolean>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap), [TableUser](#interface-tableuser)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: KnexMigrations

```ts
export class KnexMigrations implements MigrationSource<string> {
    migrations: Record<string, Migration> = {};
    constructor(public chain: Chain, public storageName: string, public storageIdentityKey: string, public maxOutputScriptLength: number)
    async getMigrations(): Promise<string[]>
    getMigrationName(migration: string)
    async getMigration(migration: string): Promise<Migration>
    async getLatestMigration(): Promise<string>
    static async latestMigration(): Promise<string>
    setupMigrations(chain: string, storageName: string, storageIdentityKey: string, maxOutputScriptLength: number): Record<string, Migration>
}
```

###### Constructor

```ts
constructor(public chain: Chain, public storageName: string, public storageIdentityKey: string, public maxOutputScriptLength: number)
```

Argument Details

+ **storageName**
  + human readable name for this storage instance
+ **maxOutputScriptLength**
  + limit for scripts kept in outputs table, longer scripts will be pulled from rawTx

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: MergeEntity

```ts
export class MergeEntity<API extends EntityTimeStamp, DE extends EntityBase<API>> {
    idMap: Record<number, number>;
    constructor(public stateArray: API[] | undefined, public find: (storage: EntityStorage, userId: number, ei: API, syncMap: SyncMap, trx?: TrxToken) => Promise<{
        found: boolean;
        eo: DE;
        eiId: number;
    }>, public esm: EntitySyncMap)
    updateSyncMap(map: Record<number, number>, inId: number, outId: number)
    async merge(since: Date | undefined, storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<{
        inserts: number;
        updates: number;
    }>
}
```

See also: [EntityBase](#class-entitybase), [EntityStorage](#type-entitystorage), [EntitySyncMap](#interface-entitysyncmap), [SyncMap](#interface-syncmap)

###### Method merge

```ts
async merge(since: Date | undefined, storage: EntityStorage, userId: number, syncMap: SyncMap, trx?: TrxToken): Promise<{
    inserts: number;
    updates: number;
}>
```
See also: [EntityStorage](#type-entitystorage), [SyncMap](#interface-syncmap)

Argument Details

+ **since**
  + date of current sync chunk

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageClient

`StorageClient` implements the `WalletStorageProvider` interface which allows it to
serve as a BRC-100 wallet's active storage.

Internally, it uses JSON-RPC over HTTPS to make requests of a remote server.
Typically this server uses the `StorageServer` class to implement the service.

The `AuthFetch` component is used to secure and authenticate the requests to the remote server.

`AuthFetch` is initialized with a BRC-100 wallet which establishes the identity of
the party making requests of the remote service.

For details of the API implemented, follow the "See also" link for the `WalletStorageProvider` interface.

```ts
export class StorageClient extends StorageClientBase {
    constructor(wallet: WalletInterface, endpointUrl: string)
    protected async rpcCall<T>(method: string, params: unknown[]): Promise<T>
}
```

See also: [StorageClientBase](#class-storageclientbase)

###### Method rpcCall

Make a JSON-RPC call to the remote server.

```ts
protected async rpcCall<T>(method: string, params: unknown[]): Promise<T>
```

Argument Details

+ **method**
  + The WalletStorage method name to call.
+ **params**
  + The array of parameters to pass to the method in order.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageClientBase

Abstract base class shared by `StorageClient` and `StorageMobile`.

Contains all `WalletStorageProvider` method implementations and entity-validation
helpers. Subclasses only need to provide `rpcCall`, which differs between
the full (logger-aware) and mobile (lightweight) variants.

```ts
export abstract class StorageClientBase implements WalletStorageProvider {
    readonly endpointUrl: string;
    protected readonly authClient: AuthFetch;
    protected nextId = 1;
    public settings?: TableSettings;
    constructor(wallet: WalletInterface, endpointUrl: string)
    isStorageProvider(): boolean
    protected abstract rpcCall<T>(method: string, params: unknown[]): Promise<T>;
    isAvailable(): boolean
    getSettings(): TableSettings
    async makeAvailable(): Promise<TableSettings>
    async destroy(): Promise<void>
    async migrate(storageName: string, storageIdentityKey: string): Promise<string>
    getServices(): WalletServices
    setServices(v: WalletServices): void
    async internalizeAction(auth: AuthId, args: InternalizeActionArgs): Promise<StorageInternalizeActionResult>
    async createAction(auth: AuthId, args: Validation.ValidCreateActionArgs): Promise<StorageCreateActionResult>
    async processAction(auth: AuthId, args: StorageProcessActionArgs): Promise<StorageProcessActionResults>
    async abortAction(auth: AuthId, args: AbortActionArgs): Promise<AbortActionResult>
    async findOrInsertUser(identityKey): Promise<{
        user: TableUser;
        isNew: boolean;
    }>
    async findOrInsertSyncStateAuth(auth: AuthId, storageIdentityKey: string, storageName: string): Promise<{
        syncState: TableSyncState;
        isNew: boolean;
    }>
    async insertCertificateAuth(auth: AuthId, certificate: TableCertificateX): Promise<number>
    async listActions(auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
    async listOutputs(auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult>
    async listCertificates(auth: AuthId, vargs: Validation.ValidListCertificatesArgs): Promise<ListCertificatesResult>
    async findCertificatesAuth(auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]>
    async findOutputBasketsAuth(auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    async findOutputsAuth(auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]>
    async findProvenTxReqs(args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>
    async relinquishCertificate(auth: AuthId, args: RelinquishCertificateArgs): Promise<number>
    async relinquishOutput(auth: AuthId, args: RelinquishOutputArgs): Promise<number>
    async processSyncChunk(args: RequestSyncChunkArgs, chunk: SyncChunk): Promise<ProcessSyncChunkResult>
    async getSyncChunk(args: RequestSyncChunkArgs): Promise<SyncChunk>
    async updateProvenTxReqWithNewProvenTx(args: UpdateProvenTxReqWithNewProvenTxArgs): Promise<UpdateProvenTxReqWithNewProvenTxResult>
    async setActive(auth: AuthId, newActiveStorageIdentityKey: string): Promise<number>
    validateDate(date: Date | string | number): Date
    validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[]): T
    validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[]): T[]
}
```

See also: [TableCertificateX](#interface-tablecertificatex), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate), [TableUser](#interface-tableuser), [createAction](#function-createaction), [getSyncChunk](#function-getsyncchunk), [internalizeAction](#function-internalizeaction), [listActions](#function-listactions), [listCertificates](#function-listcertificates), [listOutputs](#function-listoutputs), [processAction](#function-processaction), [validateDate](#function-validatedate), [validateEntities](#function-validateentities), [validateEntity](#function-validateentity)

###### Method abortAction

Aborts an action by `reference` string.

```ts
async abortAction(auth: AuthId, args: AbortActionArgs): Promise<AbortActionResult>
```

Returns

`abortAction` result.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + original wallet `abortAction` args.

###### Method createAction

Storage level processing for wallet `createAction`.

```ts
async createAction(auth: AuthId, args: Validation.ValidCreateActionArgs): Promise<StorageCreateActionResult>
```

Returns

`StorageCreateActionResults` supporting additional wallet processing to yield `createAction` results.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + Validated extension of original wallet `createAction` arguments.

###### Method destroy

Called to cleanup resources when no further use of this object will occur.

```ts
async destroy(): Promise<void>
```

###### Method findCertificatesAuth

Find user certificates, optionally with fields.

This certificate retrieval method supports internal wallet operations.
Field values are stored and retrieved encrypted.

```ts
async findCertificatesAuth(auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]>
```
See also: [TableCertificateX](#interface-tablecertificatex)

Returns

array of certificates matching args.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + `FindCertificatesArgs` determines which certificates to retrieve and whether to include fields.

###### Method findOrInsertSyncStateAuth

Used to both find and insert a `TableSyncState` record for the user to track wallet data replication across storage providers.

```ts
async findOrInsertSyncStateAuth(auth: AuthId, storageIdentityKey: string, storageName: string): Promise<{
    syncState: TableSyncState;
    isNew: boolean;
}>
```
See also: [TableSyncState](#interface-tablesyncstate)

Returns

`TableSyncState` and whether a new record was created.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **storageName**
  + the name of the remote storage being sync'd
+ **storageIdentityKey**
  + the identity key of the remote storage being sync'd

###### Method findOrInsertUser

Used to both find and initialize a new user by identity key.
It is up to the remote storage whether to allow creation of new users by this method.

```ts
async findOrInsertUser(identityKey): Promise<{
    user: TableUser;
    isNew: boolean;
}>
```
See also: [TableUser](#interface-tableuser)

Returns

`TableUser` for the user and whether a new user was created.

Argument Details

+ **identityKey**
  + of the user.

###### Method findOutputBasketsAuth

Find output baskets.

This retrieval method supports internal wallet operations.

```ts
async findOutputBasketsAuth(auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
```
See also: [TableOutputBasket](#interface-tableoutputbasket)

Returns

array of output baskets matching args.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + `FindOutputBasketsArgs` determines which baskets to retrieve.

###### Method findOutputsAuth

Find outputs.

This retrieval method supports internal wallet operations.

```ts
async findOutputsAuth(auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]>
```
See also: [TableOutput](#interface-tableoutput)

Returns

array of outputs matching args.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + `FindOutputsArgs` determines which outputs to retrieve.

###### Method findProvenTxReqs

Find requests for transaction proofs.

This retrieval method supports internal wallet operations.

```ts
async findProvenTxReqs(args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>
```
See also: [TableProvenTxReq](#interface-tableproventxreq)

Returns

array of proof requests matching args.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + `FindProvenTxReqsArgs` determines which proof requests to retrieve.

###### Method getServices

Remote storage does not offer `Services` to remote clients.

```ts
getServices(): WalletServices
```

Throws

WERR_INVALID_OPERATION

###### Method getSettings

```ts
getSettings(): TableSettings
```
See also: [TableSettings](#interface-tablesettings)

Returns

remote storage `TableSettings` if they have been retreived by `makeAvailable`.

Throws

WERR_INVALID_OPERATION if `makeAvailable` has not yet been called.

###### Method getSyncChunk

Request a "chunk" of replication data for a specific user and storage provider.

The normal data flow is for the active storage to push backups as a sequence of data chunks to backup storage providers.
Also supports recovery where non-active storage can attempt to merge available data prior to becoming active.

```ts
async getSyncChunk(args: RequestSyncChunkArgs): Promise<SyncChunk>
```

Returns

the next "chunk" of replication data

Argument Details

+ **args**
  + that identify the non-active storage which will receive replication data and constrains the replication process.

###### Method insertCertificateAuth

Inserts a new certificate with fields and keyring into remote storage.

```ts
async insertCertificateAuth(auth: AuthId, certificate: TableCertificateX): Promise<number>
```
See also: [TableCertificateX](#interface-tablecertificatex)

Returns

record Id of the inserted `TableCertificate` record.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **certificate**
  + the certificate to insert.

###### Method internalizeAction

Storage level processing for wallet `internalizeAction`.
Updates internalized outputs in remote storage.
Triggers proof validation of containing transaction.

```ts
async internalizeAction(auth: AuthId, args: InternalizeActionArgs): Promise<StorageInternalizeActionResult>
```

Returns

`internalizeAction` results

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + Original wallet `internalizeAction` arguments.

###### Method isAvailable

```ts
isAvailable(): boolean
```

Returns

true once storage `TableSettings` have been retreived from remote storage.

###### Method isStorageProvider

The `StorageClient` implements the `WalletStorageProvider` interface.
It does not implement the lower level `StorageProvider` interface.

```ts
isStorageProvider(): boolean
```

Returns

false

###### Method listActions

Storage level processing for wallet `listActions`.

```ts
async listActions(auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
```

Returns

`listActions` results.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + Validated extension of original wallet `listActions` arguments.

###### Method listCertificates

Storage level processing for wallet `listCertificates`.

```ts
async listCertificates(auth: AuthId, vargs: Validation.ValidListCertificatesArgs): Promise<ListCertificatesResult>
```

Returns

`listCertificates` results.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + Validated extension of original wallet `listCertificates` arguments.

###### Method listOutputs

Storage level processing for wallet `listOutputs`.

```ts
async listOutputs(auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult>
```

Returns

`listOutputs` results.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + Validated extension of original wallet `listOutputs` arguments.

###### Method makeAvailable

Must be called prior to making use of storage.
Retreives `TableSettings` from remote storage provider.

```ts
async makeAvailable(): Promise<TableSettings>
```
See also: [TableSettings](#interface-tablesettings)

Returns

remote storage `TableSettings`

###### Method migrate

Requests schema migration to latest.
Typically remote storage will ignore this request.

```ts
async migrate(storageName: string, storageIdentityKey: string): Promise<string>
```

Returns

current schema migration identifier

Argument Details

+ **storageName**
  + Unique human readable name for remote storage if it does not yet exist.
+ **storageIdentityKey**
  + Unique identity key for remote storage if it does not yet exist.

###### Method processAction

Storage level processing for wallet `createAction` and `signAction`.

Handles remaining storage tasks once a fully signed transaction has been completed. This is common to both `createAction` and `signAction`.

```ts
async processAction(auth: AuthId, args: StorageProcessActionArgs): Promise<StorageProcessActionResults>
```

Returns

`StorageProcessActionResults` supporting final wallet processing to yield `createAction` or `signAction` results.

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + `StorageProcessActionArgs` convey completed signed transaction to storage.

###### Method processSyncChunk

Process a "chunk" of replication data for the user.

The normal data flow is for the active storage to push backups as a sequence of data chunks to backup storage providers.

```ts
async processSyncChunk(args: RequestSyncChunkArgs, chunk: SyncChunk): Promise<ProcessSyncChunkResult>
```

Returns

whether processing is done, counts of inserts and udpates, and related progress tracking properties.

Argument Details

+ **args**
  + a copy of the replication request args that initiated the sequence of data chunks.
+ **chunk**
  + the current data chunk to process.

###### Method relinquishCertificate

Relinquish a certificate.

For storage supporting replication records must be kept of deletions. Therefore certificates are marked as deleted
when relinquished, and no longer returned by `listCertificates`, but are still retained by storage.

```ts
async relinquishCertificate(auth: AuthId, args: RelinquishCertificateArgs): Promise<number>
```

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + original wallet `relinquishCertificate` args.

###### Method relinquishOutput

Relinquish an output.

Relinquishing an output removes the output from whatever basket was tracking it.

```ts
async relinquishOutput(auth: AuthId, args: RelinquishOutputArgs): Promise<number>
```

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **args**
  + original wallet `relinquishOutput` args.

###### Method rpcCall

Make a JSON-RPC call to the remote server.
Implemented differently by each subclass (with or without logger support).

```ts
protected abstract rpcCall<T>(method: string, params: unknown[]): Promise<T>
```

Argument Details

+ **method**
  + The WalletStorage method name to call.
+ **params**
  + The array of parameters to pass to the method in order.

###### Method setActive

Ensures up-to-date wallet data replication to all configured backup storage providers,
then promotes one of the configured backups to active,
demoting the current active to new backup.

```ts
async setActive(auth: AuthId, newActiveStorageIdentityKey: string): Promise<number>
```

Argument Details

+ **auth**
  + Identifies client by identity key and the storage identity key of their currently active storage.
This must match the `AuthFetch` identity securing the remote conneciton.
+ **newActiveStorageIdentityKey**
  + which must be a currently configured backup storage provider.

###### Method setServices

Ignored. Remote storage cannot share `Services` with remote clients.

```ts
setServices(v: WalletServices): void
```

###### Method updateProvenTxReqWithNewProvenTx

Handles the data received when a new transaction proof is found in response to an outstanding request for proof data:

  - Creates a new `TableProvenTx` record.
  - Notifies all user transaction records of the new status.
  - Updates the proof request record to 'completed' status which enables delayed deletion.

```ts
async updateProvenTxReqWithNewProvenTx(args: UpdateProvenTxReqWithNewProvenTxArgs): Promise<UpdateProvenTxReqWithNewProvenTxResult>
```

Returns

results of updates

Argument Details

+ **args**
  + proof request and new transaction proof data

###### Method validateEntities

Helper to force uniform behavior across database engines.
Use to process all arrays of records with time stamps retreived from database.

```ts
validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[]): T[]
```

Returns

input `entities` array with contained values validated.

###### Method validateEntity

Helper to force uniform behavior across database engines.
Use to process all individual records with time stamps retreived from database.

```ts
validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[]): T
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageIdb

This class implements the `StorageProvider` interface using IndexedDB,
via the promises wrapper package `idb`.

```ts
export class StorageIdb extends StorageProvider implements WalletStorageProvider {
    dbName: string;
    db?: IDBPDatabase<StorageIdbSchema>;
    constructor(options: StorageIdbOptions)
    async migrate(storageName: string, storageIdentityKey: string): Promise<string>
    async verifyDB(storageName?: string, storageIdentityKey?: string): Promise<IDBPDatabase<StorageIdbSchema>>
    toDbTrx(stores: string[], mode: "readonly" | "readwrite", trx?: TrxToken): IDBPTransaction<StorageIdbSchema, string[], "readwrite" | "readonly">
    async readSettings(trx?: TrxToken): Promise<TableSettings>
    async initDB(storageName?: string, storageIdentityKey?: string): Promise<IDBPDatabase<StorageIdbSchema>>
    async reviewStatus(args: {
        agedLimit: Date;
        trx?: TrxToken;
    }): Promise<{
        log: string;
    }>
    async purgeData(params: PurgeParams, trx?: TrxToken): Promise<PurgeResults>
    async allocateChangeInput(userId: number, basketId: number, targetSatoshis: number, exactSatoshis: number | undefined, excludeSending: boolean, transactionId: number): Promise<TableOutput | undefined>
    async getProvenOrRawTx(txid: string, trx?: TrxToken): Promise<ProvenOrRawTx>
    async getRawTxOfKnownValidTransaction(txid?: string, offset?: number, length?: number, trx?: TrxToken): Promise<number[] | undefined>
    async getLabelsForTransactionId(transactionId?: number, trx?: TrxToken): Promise<TableTxLabel[]>
    async getTagsForOutputId(outputId: number, trx?: TrxToken): Promise<TableOutputTag[]>
    async listActions(auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
    async listOutputs(auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult>
    async countChangeInputs(userId: number, basketId: number, excludeSending: boolean): Promise<number>
    async findCertificatesAuth(auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]>
    async findOutputBasketsAuth(auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    async findOutputsAuth(auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]>
    async insertCertificateAuth(auth: AuthId, certificate: TableCertificateX): Promise<number>
    async dropAllData(): Promise<void>
    async filterOutputTagMaps(args: FindOutputTagMapsArgs, filtered: (v: TableOutputTagMap) => void, userId?: number): Promise<void>
    async findOutputTagMaps(args: FindOutputTagMapsArgs): Promise<TableOutputTagMap[]>
    async filterProvenTxReqs(args: FindProvenTxReqsArgs, filtered: (v: TableProvenTxReq) => void, userId?: number): Promise<void>
    async findProvenTxReqs(args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>
    async filterProvenTxs(args: FindProvenTxsArgs, filtered: (v: TableProvenTx) => void, userId?: number): Promise<void>
    async findProvenTxs(args: FindProvenTxsArgs): Promise<TableProvenTx[]>
    async filterTxLabelMaps(args: FindTxLabelMapsArgs, filtered: (v: TableTxLabelMap) => void, userId?: number): Promise<void>
    async findTxLabelMaps(args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]>
    async countOutputTagMaps(args: FindOutputTagMapsArgs): Promise<number>
    async countProvenTxReqs(args: FindProvenTxReqsArgs): Promise<number>
    async countProvenTxs(args: FindProvenTxsArgs): Promise<number>
    async countTxLabelMaps(args: FindTxLabelMapsArgs): Promise<number>
    async insertCertificate(certificate: TableCertificateX, trx?: TrxToken): Promise<number>
    async insertCertificateField(certificateField: TableCertificateField, trx?: TrxToken): Promise<void>
    async insertCommission(commission: TableCommission, trx?: TrxToken): Promise<number>
    async insertMonitorEvent(event: TableMonitorEvent, trx?: TrxToken): Promise<number>
    async insertOutput(output: TableOutput, trx?: TrxToken): Promise<number>
    async insertOutputBasket(basket: TableOutputBasket, trx?: TrxToken): Promise<number>
    async insertOutputTag(tag: TableOutputTag, trx?: TrxToken): Promise<number>
    async insertOutputTagMap(tagMap: TableOutputTagMap, trx?: TrxToken): Promise<void>
    async insertProvenTx(tx: TableProvenTx, trx?: TrxToken): Promise<number>
    async insertProvenTxReq(tx: TableProvenTxReq, trx?: TrxToken): Promise<number>
    async insertSyncState(syncState: TableSyncState, trx?: TrxToken): Promise<number>
    async insertTransaction(tx: TableTransaction, trx?: TrxToken): Promise<number>
    async insertTxLabel(label: TableTxLabel, trx?: TrxToken): Promise<number>
    async insertTxLabelMap(labelMap: TableTxLabelMap, trx?: TrxToken): Promise<void>
    async insertUser(user: TableUser, trx?: TrxToken): Promise<number>
    async updateIdb<T>(id: number | number[], update: Partial<T>, keyProp: string, storeName: string, trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<number>
    async updateIdbKey<T>(key: Array<number | string>, update: Partial<T>, keyProps: string[], storeName: string, trx?: TrxToken): Promise<number>
    async updateCertificate(id: number, update: Partial<TableCertificate>, trx?: TrxToken): Promise<number>
    async updateCertificateField(certificateId: number, fieldName: string, update: Partial<TableCertificateField>, trx?: TrxToken): Promise<number>
    async updateCommission(id: number, update: Partial<TableCommission>, trx?: TrxToken): Promise<number>
    async updateMonitorEvent(id: number, update: Partial<TableMonitorEvent>, trx?: TrxToken): Promise<number>
    async updateOutput(id: number, update: Partial<TableOutput>, trx?: TrxToken): Promise<number>
    async updateOutputBasket(id: number, update: Partial<TableOutputBasket>, trx?: TrxToken): Promise<number>
    async updateOutputTag(id: number, update: Partial<TableOutputTag>, trx?: TrxToken): Promise<number>
    async updateProvenTx(id: number, update: Partial<TableProvenTx>, trx?: TrxToken): Promise<number>
    async updateProvenTxReq(id: number | number[], update: Partial<TableProvenTxReq>, trx?: TrxToken): Promise<number>
    async updateSyncState(id: number, update: Partial<TableSyncState>, trx?: TrxToken): Promise<number>
    async updateTransaction(id: number | number[], update: Partial<TableTransaction>, trx?: TrxToken): Promise<number>
    async updateTxLabel(id: number, update: Partial<TableTxLabel>, trx?: TrxToken): Promise<number>
    async updateUser(id: number, update: Partial<TableUser>, trx?: TrxToken): Promise<number>
    async updateOutputTagMap(outputId: number, tagId: number, update: Partial<TableOutputTagMap>, trx?: TrxToken): Promise<number>
    async updateTxLabelMap(transactionId: number, txLabelId: number, update: Partial<TableTxLabelMap>, trx?: TrxToken): Promise<number>
    async destroy(): Promise<void>
    allStores: string[] = [
        "certificates",
        "certificate_fields",
        "commissions",
        "monitor_events",
        "outputs",
        "output_baskets",
        "output_tags",
        "output_tags_map",
        "proven_txs",
        "proven_tx_reqs",
        "sync_states",
        "transactions",
        "tx_labels",
        "tx_labels_map",
        "users"
    ];
    async transaction<T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T>
    async filterCertificateFields(args: FindCertificateFieldsArgs, filtered: (v: TableCertificateField) => void): Promise<void>
    async findCertificateFields(args: FindCertificateFieldsArgs): Promise<TableCertificateField[]>
    async filterCertificates(args: FindCertificatesArgs, filtered: (v: TableCertificateX) => void): Promise<void>
    async findCertificates(args: FindCertificatesArgs): Promise<TableCertificateX[]>
    async filterCommissions(args: FindCommissionsArgs, filtered: (v: TableCommission) => void): Promise<void>
    async findCommissions(args: FindCommissionsArgs): Promise<TableCommission[]>
    async filterMonitorEvents(args: FindMonitorEventsArgs, filtered: (v: TableMonitorEvent) => void): Promise<void>
    async findMonitorEvents(args: FindMonitorEventsArgs): Promise<TableMonitorEvent[]>
    async filterOutputBaskets(args: FindOutputBasketsArgs, filtered: (v: TableOutputBasket) => void): Promise<void>
    async findOutputBaskets(args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    async filterOutputs(args: FindOutputsArgs, filtered: (v: TableOutput) => void, tagIds?: number[], isQueryModeAll?: boolean): Promise<void>
    async findOutputs(args: FindOutputsArgs, tagIds?: number[], isQueryModeAll?: boolean): Promise<TableOutput[]>
    async filterOutputTags(args: FindOutputTagsArgs, filtered: (v: TableOutputTag) => void): Promise<void>
    async findOutputTags(args: FindOutputTagsArgs): Promise<TableOutputTag[]>
    async filterSyncStates(args: FindSyncStatesArgs, filtered: (v: TableSyncState) => void): Promise<void>
    async findSyncStates(args: FindSyncStatesArgs): Promise<TableSyncState[]>
    async filterTransactions(args: FindTransactionsArgs, filtered: (v: TableTransaction) => void, labelIds?: number[], isQueryModeAll?: boolean): Promise<void>
    async findTransactions(args: FindTransactionsArgs, labelIds?: number[], isQueryModeAll?: boolean): Promise<TableTransaction[]>
    async filterTxLabels(args: FindTxLabelsArgs, filtered: (v: TableTxLabel) => void): Promise<void>
    async findTxLabels(args: FindTxLabelsArgs): Promise<TableTxLabel[]>
    async filterUsers(args: FindUsersArgs, filtered: (v: TableUser) => void): Promise<void>
    async findUsers(args: FindUsersArgs): Promise<TableUser[]>
    async countCertificateFields(args: FindCertificateFieldsArgs): Promise<number>
    async countCertificates(args: FindCertificatesArgs): Promise<number>
    async countCommissions(args: FindCommissionsArgs): Promise<number>
    async countMonitorEvents(args: FindMonitorEventsArgs): Promise<number>
    async countOutputBaskets(args: FindOutputBasketsArgs): Promise<number>
    async countOutputs(args: FindOutputsArgs, tagIds?: number[], isQueryModeAll?: boolean): Promise<number>
    async countOutputTags(args: FindOutputTagsArgs): Promise<number>
    async countSyncStates(args: FindSyncStatesArgs): Promise<number>
    async countTransactions(args: FindTransactionsArgs, labelIds?: number[], isQueryModeAll?: boolean): Promise<number>
    async countTxLabels(args: FindTxLabelsArgs): Promise<number>
    async countUsers(args: FindUsersArgs): Promise<number>
    async getProvenTxsForUser(args: FindForUserSincePagedArgs): Promise<TableProvenTx[]>
    async getProvenTxReqsForUser(args: FindForUserSincePagedArgs): Promise<TableProvenTxReq[]>
    async getTxLabelMapsForUser(args: FindForUserSincePagedArgs): Promise<TableTxLabelMap[]>
    async getOutputTagMapsForUser(args: FindForUserSincePagedArgs): Promise<TableOutputTagMap[]>
    async verifyReadyForDatabaseAccess(trx?: TrxToken): Promise<DBType>
    validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[], booleanFields?: string[]): T
    validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[], booleanFields?: string[]): T[]
    validatePartialForUpdate<T extends EntityTimeStamp>(update: Partial<T>, dateFields?: string[], booleanFields?: string[]): Partial<T>
    async validateEntityForInsert<T extends EntityTimeStamp>(entity: T, trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<any>
    async validateRawTransaction(t: TableTransaction, trx?: TrxToken): Promise<void>
    async adminStats(adminIdentityKey: string): Promise<StorageAdminStats>
}
```

See also: [DBType](#type-dbtype), [StorageAdminStats](#interface-storageadminstats), [StorageIdbOptions](#interface-storageidboptions), [StorageIdbSchema](#interface-storageidbschema), [StorageProvider](#class-storageprovider), [TableCertificate](#interface-tablecertificate), [TableCertificateField](#interface-tablecertificatefield), [TableCertificateX](#interface-tablecertificatex), [TableCommission](#interface-tablecommission), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputTagMap](#interface-tableoutputtagmap), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate), [TableTransaction](#interface-tabletransaction), [TableTxLabel](#interface-tabletxlabel), [TableTxLabelMap](#interface-tabletxlabelmap), [TableUser](#interface-tableuser), [listActions](#function-listactions), [listOutputs](#function-listoutputs), [purgeData](#function-purgedata), [reviewStatus](#function-reviewstatus), [validateEntities](#function-validateentities), [validateEntity](#function-validateentity)

###### Method allocateChangeInput

Proceeds in three stages:
1. Find an output that exactly funds the transaction (if exactSatoshis is not undefined).
2. Find an output that overfunds by the least amount (targetSatoshis).
3. Find an output that comes as close to funding as possible (targetSatoshis).
4. Return undefined if no output is found.

Outputs must belong to userId and basketId and have spendable true.
Their corresponding transaction must have status of 'completed', 'unproven', or 'sending' (if excludeSending is false).

```ts
async allocateChangeInput(userId: number, basketId: number, targetSatoshis: number, exactSatoshis: number | undefined, excludeSending: boolean, transactionId: number): Promise<TableOutput | undefined>
```
See also: [TableOutput](#interface-tableoutput)

Returns

next funding output to add to transaction or undefined if there are none.

###### Method migrate

This method must be called at least once before any other method accesses the database,
and each time the schema may have updated.

If the database has already been created in this context, `storageName` and `storageIdentityKey`
are ignored.

```ts
async migrate(storageName: string, storageIdentityKey: string): Promise<string>
```

###### Method readSettings

Called by `makeAvailable` to return storage `TableSettings`.
Since this is the first async method that must be called by all clients,
it is where async initialization occurs.

After initialization, cached settings are returned.

```ts
async readSettings(trx?: TrxToken): Promise<TableSettings>
```
See also: [TableSettings](#interface-tablesettings)

###### Method toDbTrx

Convert the standard optional `TrxToken` parameter into either a direct knex database instance,
or a Knex.Transaction as appropriate.

```ts
toDbTrx(stores: string[], mode: "readonly" | "readwrite", trx?: TrxToken): IDBPTransaction<StorageIdbSchema, string[], "readwrite" | "readonly">
```
See also: [StorageIdbSchema](#interface-storageidbschema)

###### Method validateEntities

Helper to force uniform behavior across database engines.
Use to process all arrays of records with time stamps retreived from database.

```ts
validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[], booleanFields?: string[]): T[]
```

Returns

input `entities` array with contained values validated.

###### Method validateEntity

Helper to force uniform behavior across database engines.
Use to process all individual records with time stamps or number[] retreived from database.

```ts
validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[], booleanFields?: string[]): T
```

###### Method validateEntityForInsert

Helper to force uniform behavior across database engines.
Use to process new entities being inserted into the database.

```ts
async validateEntityForInsert<T extends EntityTimeStamp>(entity: T, trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<any>
```

###### Method validatePartialForUpdate

Helper to force uniform behavior across database engines.
Use to process the update template for entities being updated.

```ts
validatePartialForUpdate<T extends EntityTimeStamp>(update: Partial<T>, dateFields?: string[], booleanFields?: string[]): Partial<T>
```

###### Method verifyDB

Following initial database initialization, this method verfies that db is ready for use.

```ts
async verifyDB(storageName?: string, storageIdentityKey?: string): Promise<IDBPDatabase<StorageIdbSchema>>
```
See also: [StorageIdbSchema](#interface-storageidbschema)

Throws

`WERR_INVALID_OPERATION` if the database has not been initialized by a call to `migrate`.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageKnex

```ts
export class StorageKnex extends StorageProvider implements WalletStorageProvider {
    knex: Knex;
    constructor(options: StorageKnexOptions)
    async readSettings(): Promise<TableSettings>
    override async getProvenOrRawTx(txid: string, trx?: TrxToken): Promise<ProvenOrRawTx>
    dbTypeSubstring(source: string, fromOffset: number, forLength?: number)
    override async getRawTxOfKnownValidTransaction(txid?: string, offset?: number, length?: number, trx?: TrxToken): Promise<number[] | undefined>
    getProvenTxsForUserQuery(args: FindForUserSincePagedArgs): Knex.QueryBuilder
    override async getProvenTxsForUser(args: FindForUserSincePagedArgs): Promise<TableProvenTx[]>
    getProvenTxReqsForUserQuery(args: FindForUserSincePagedArgs): Knex.QueryBuilder
    override async getProvenTxReqsForUser(args: FindForUserSincePagedArgs): Promise<TableProvenTxReq[]>
    getTxLabelMapsForUserQuery(args: FindForUserSincePagedArgs): Knex.QueryBuilder
    override async getTxLabelMapsForUser(args: FindForUserSincePagedArgs): Promise<TableTxLabelMap[]>
    getOutputTagMapsForUserQuery(args: FindForUserSincePagedArgs): Knex.QueryBuilder
    override async getOutputTagMapsForUser(args: FindForUserSincePagedArgs): Promise<TableOutputTagMap[]>
    override async listActions(auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
    override async listOutputs(auth: AuthId, vargs: Validation.ValidListOutputsArgs): Promise<ListOutputsResult>
    override async insertProvenTx(tx: TableProvenTx, trx?: TrxToken): Promise<number>
    override async insertProvenTxReq(tx: TableProvenTxReq, trx?: TrxToken): Promise<number>
    override async insertUser(user: TableUser, trx?: TrxToken): Promise<number>
    override async insertCertificateAuth(auth: AuthId, certificate: TableCertificateX): Promise<number>
    override async insertCertificate(certificate: TableCertificateX, trx?: TrxToken): Promise<number>
    override async insertCertificateField(certificateField: TableCertificateField, trx?: TrxToken): Promise<void>
    override async insertOutputBasket(basket: TableOutputBasket, trx?: TrxToken): Promise<number>
    override async insertTransaction(tx: TableTransaction, trx?: TrxToken): Promise<number>
    override async insertCommission(commission: TableCommission, trx?: TrxToken): Promise<number>
    override async insertOutput(output: TableOutput, trx?: TrxToken): Promise<number>
    override async insertOutputTag(tag: TableOutputTag, trx?: TrxToken): Promise<number>
    override async insertOutputTagMap(tagMap: TableOutputTagMap, trx?: TrxToken): Promise<void>
    override async insertTxLabel(label: TableTxLabel, trx?: TrxToken): Promise<number>
    override async insertTxLabelMap(labelMap: TableTxLabelMap, trx?: TrxToken): Promise<void>
    override async insertMonitorEvent(event: TableMonitorEvent, trx?: TrxToken): Promise<number>
    override async insertSyncState(syncState: TableSyncState, trx?: TrxToken): Promise<number>
    override async updateCertificateField(certificateId: number, fieldName: string, update: Partial<TableCertificateField>, trx?: TrxToken): Promise<number>
    override async updateCertificate(id: number, update: Partial<TableCertificate>, trx?: TrxToken): Promise<number>
    override async updateCommission(id: number, update: Partial<TableCommission>, trx?: TrxToken): Promise<number>
    override async updateOutputBasket(id: number, update: Partial<TableOutputBasket>, trx?: TrxToken): Promise<number>
    override async updateOutput(id: number, update: Partial<TableOutput>, trx?: TrxToken): Promise<number>
    override async updateOutputTagMap(outputId: number, tagId: number, update: Partial<TableOutputTagMap>, trx?: TrxToken): Promise<number>
    override async updateOutputTag(id: number, update: Partial<TableOutputTag>, trx?: TrxToken): Promise<number>
    override async updateProvenTxReq(id: number | number[], update: Partial<TableProvenTxReq>, trx?: TrxToken): Promise<number>
    override async updateProvenTx(id: number, update: Partial<TableProvenTx>, trx?: TrxToken): Promise<number>
    override async updateSyncState(id: number, update: Partial<TableSyncState>, trx?: TrxToken): Promise<number>
    override async updateTransaction(id: number | number[], update: Partial<TableTransaction>, trx?: TrxToken): Promise<number>
    override async updateTxLabelMap(transactionId: number, txLabelId: number, update: Partial<TableTxLabelMap>, trx?: TrxToken): Promise<number>
    override async updateTxLabel(id: number, update: Partial<TableTxLabel>, trx?: TrxToken): Promise<number>
    override async updateUser(id: number, update: Partial<TableUser>, trx?: TrxToken): Promise<number>
    override async updateMonitorEvent(id: number, update: Partial<TableMonitorEvent>, trx?: TrxToken): Promise<number>
    setupQuery<T extends object>(table: string, args: FindPartialSincePagedArgs<T>): Knex.QueryBuilder
    findCertificateFieldsQuery(args: FindCertificateFieldsArgs): Knex.QueryBuilder
    findCertificatesQuery(args: FindCertificatesArgs): Knex.QueryBuilder
    findCommissionsQuery(args: FindCommissionsArgs): Knex.QueryBuilder
    findOutputBasketsQuery(args: FindOutputBasketsArgs): Knex.QueryBuilder
    findOutputsQuery(args: FindOutputsArgs, count?: boolean): Knex.QueryBuilder
    findOutputTagMapsQuery(args: FindOutputTagMapsArgs): Knex.QueryBuilder
    findOutputTagsQuery(args: FindOutputTagsArgs): Knex.QueryBuilder
    findProvenTxReqsQuery(args: FindProvenTxReqsArgs): Knex.QueryBuilder
    findProvenTxsQuery(args: FindProvenTxsArgs): Knex.QueryBuilder
    findStaleMerkleRootsQuery(args: FindStaleMerkleRootsArgs): Knex.QueryBuilder
    findSyncStatesQuery(args: FindSyncStatesArgs): Knex.QueryBuilder
    findTransactionsQuery(args: FindTransactionsArgs, count?: boolean): Knex.QueryBuilder
    findTxLabelMapsQuery(args: FindTxLabelMapsArgs): Knex.QueryBuilder
    findTxLabelsQuery(args: FindTxLabelsArgs): Knex.QueryBuilder
    findUsersQuery(args: FindUsersArgs): Knex.QueryBuilder
    findMonitorEventsQuery(args: FindMonitorEventsArgs): Knex.QueryBuilder
    override async findCertificatesAuth(auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]>
    override async findOutputBasketsAuth(auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    override async findOutputsAuth(auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]>
    override async findCertificateFields(args: FindCertificateFieldsArgs): Promise<TableCertificateField[]>
    override async findCertificates(args: FindCertificatesArgs): Promise<TableCertificateX[]>
    override async findCommissions(args: FindCommissionsArgs): Promise<TableCommission[]>
    override async findOutputBaskets(args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    override async findOutputs(args: FindOutputsArgs): Promise<TableOutput[]>
    override async findOutputTagMaps(args: FindOutputTagMapsArgs): Promise<TableOutputTagMap[]>
    override async findOutputTags(args: FindOutputTagsArgs): Promise<TableOutputTag[]>
    override async findProvenTxReqs(args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>
    override async findProvenTxs(args: FindProvenTxsArgs): Promise<TableProvenTx[]>
    override async findStaleMerkleRoots(args: FindStaleMerkleRootsArgs): Promise<string[]>
    override async findSyncStates(args: FindSyncStatesArgs): Promise<TableSyncState[]>
    override async findTransactions(args: FindTransactionsArgs): Promise<TableTransaction[]>
    override async findTxLabelMaps(args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]>
    override async findTxLabels(args: FindTxLabelsArgs): Promise<TableTxLabel[]>
    override async findUsers(args: FindUsersArgs): Promise<TableUser[]>
    override async recentlyActiveUsers(limit = 50, trx?: TrxToken): Promise<TableUser[]>
    override async findMonitorEvents(args: FindMonitorEventsArgs): Promise<TableMonitorEvent[]>
    async getCount<T extends object>(q: Knex.QueryBuilder<T, T[]>): Promise<number>
    override async countCertificateFields(args: FindCertificateFieldsArgs): Promise<number>
    override async countCertificates(args: FindCertificatesArgs): Promise<number>
    override async countCommissions(args: FindCommissionsArgs): Promise<number>
    override async countOutputBaskets(args: FindOutputBasketsArgs): Promise<number>
    override async countOutputs(args: FindOutputsArgs): Promise<number>
    override async countOutputTagMaps(args: FindOutputTagMapsArgs): Promise<number>
    override async countOutputTags(args: FindOutputTagsArgs): Promise<number>
    override async countProvenTxReqs(args: FindProvenTxReqsArgs): Promise<number>
    override async countProvenTxs(args: FindProvenTxsArgs): Promise<number>
    override async countSyncStates(args: FindSyncStatesArgs): Promise<number>
    override async countTransactions(args: FindTransactionsArgs): Promise<number>
    override async countTxLabelMaps(args: FindTxLabelMapsArgs): Promise<number>
    override async countTxLabels(args: FindTxLabelsArgs): Promise<number>
    override async countUsers(args: FindUsersArgs): Promise<number>
    override async countMonitorEvents(args: FindMonitorEventsArgs): Promise<number>
    override async destroy(): Promise<void>
    override async migrate(storageName: string, storageIdentityKey: string): Promise<string>
    override async dropAllData(): Promise<void>
    override async transaction<T>(scope: (trx: TrxToken) => Promise<T>, trx?: TrxToken): Promise<T>
    toDb(trx?: TrxToken)
    async validateRawTransaction(t: TableTransaction, trx?: TrxToken): Promise<void>
    _verifiedReadyForDatabaseAccess: boolean = false;
    async verifyReadyForDatabaseAccess(trx?: TrxToken): Promise<DBType>
    validatePartialForUpdate<T extends EntityTimeStamp>(update: Partial<T>, dateFields?: string[], booleanFields?: string[]): Partial<T>
    async validateEntityForInsert<T extends EntityTimeStamp>(entity: T, trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<any>
    override async getLabelsForTransactionId(transactionId?: number, trx?: TrxToken): Promise<TableTxLabel[]>
    override async getTagsForOutputId(outputId: number, trx?: TrxToken): Promise<TableOutputTag[]>
    override async purgeData(params: PurgeParams, trx?: TrxToken): Promise<PurgeResults>
    override async reviewStatus(args: {
        agedLimit: Date;
        trx?: TrxToken;
    }): Promise<{
        log: string;
    }>
    async countChangeInputs(userId: number, basketId: number, excludeSending: boolean): Promise<number>
    override async findOutputsByIds(outputIds: number[], trx?: TrxToken): Promise<Record<number, TableOutput>>
    override async findOutputsByOutpoints(userId: number, outpoints: Array<{
        txid: string;
        vout: number;
    }>, trx?: TrxToken): Promise<Record<string, TableOutput>>
    override async findOrInsertOutputBasketsBulk(userId: number, names: string[], trx?: TrxToken): Promise<Record<string, TableOutputBasket>>
    override async findOrInsertOutputTagsBulk(userId: number, tags: string[], trx?: TrxToken): Promise<Record<string, TableOutputTag>>
    override async sumSpendableSatoshisInBasket(userId: number, basketId: number, excludeSending: boolean, trx?: TrxToken): Promise<number>
    async allocateChangeInput(userId: number, basketId: number, targetSatoshis: number, exactSatoshis: number | undefined, excludeSending: boolean, transactionId: number): Promise<TableOutput | undefined>
    validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[], booleanFields?: string[]): T
    validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[], booleanFields?: string[]): T[]
    async adminStats(adminIdentityKey: string): Promise<AdminStatsResult> {
        if (this.dbtype !== "MySQL")
            throw new WERR_NOT_IMPLEMENTED("adminStats, only MySQL is supported");
        const monitorEvent = verifyOneOrNone(await this.findMonitorEvents({
            partial: { event: "MonitorCallHistory" },
            orderDescending: true,
            paged: { limit: 1 }
        }));
        const monitorStats: ServicesCallHistory | undefined = (monitorEvent != null) ? JSON.parse(monitorEvent.details!) : undefined;
        const servicesStats = this.getServices().getServicesCallHistory(true);
        const one_day_ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const one_week_ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const one_month_ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const [[{ usersDay, usersMonth, usersWeek, usersTotal, transactionsDay, transactionsMonth, transactionsWeek, transactionsTotal, txCompletedDay, txCompletedMonth, txCompletedWeek, txCompletedTotal, txFailedDay, txFailedMonth, txFailedWeek, txFailedTotal, txAbandonedDay, txAbandonedMonth, txAbandonedWeek, txAbandonedTotal, txUnprocessedDay, txUnprocessedMonth, txUnprocessedWeek, txUnprocessedTotal, txSendingDay, txSendingMonth, txSendingWeek, txSendingTotal, txUnprovenDay, txUnprovenMonth, txUnprovenWeek, txUnprovenTotal, txUnsignedDay, txUnsignedMonth, txUnsignedWeek, txUnsignedTotal, txNosendDay, txNosendMonth, txNosendWeek, txNosendTotal, txNonfinalDay, txNonfinalMonth, txNonfinalWeek, txNonfinalTotal, txUnfailDay, txUnfailMonth, txUnfailWeek, txUnfailTotal, satoshisDefaultDay, satoshisDefaultMonth, satoshisDefaultWeek, satoshisDefaultTotal, satoshisOtherDay, satoshisOtherMonth, satoshisOtherWeek, satoshisOtherTotal, basketsDay, basketsMonth, basketsWeek, basketsTotal, labelsDay, labelsMonth, labelsWeek, labelsTotal, tagsDay, tagsMonth, tagsWeek, tagsTotal }]] = await this.knex.raw(`
select
    (select count(*) from users where created_at > '${one_day_ago}') as usersDay,
    (select count(*) from users where created_at > '${one_week_ago}') as usersWeek,
    (select count(*) from users where created_at > '${one_month_ago}') as usersMonth,
	  (select count(*) from users) as usersTotal,
    (select count(*) from transactions where created_at > '${one_day_ago}') as transactionsDay,
    (select count(*) from transactions where created_at > '${one_week_ago}') as transactionsWeek,
    (select count(*) from transactions where created_at > '${one_month_ago}') as transactionsMonth,
	  (select count(*) from transactions) as transactionsTotal,
    (select count(*) from transactions where status = 'completed' and created_at > '${one_day_ago}') as txCompletedDay,
    (select count(*) from transactions where status = 'completed' and created_at > '${one_week_ago}') as txCompletedWeek,
    (select count(*) from transactions where status = 'completed' and created_at > '${one_month_ago}') as txCompletedMonth,
	  (select count(*) from transactions where status = 'completed') as txCompletedTotal,
    (select count(*) from transactions where status = 'failed' and not txid is null and created_at > '${one_day_ago}') as txFailedDay,
    (select count(*) from transactions where status = 'failed' and not txid is null and created_at > '${one_week_ago}') as txFailedWeek,
    (select count(*) from transactions where status = 'failed' and not txid is null and created_at > '${one_month_ago}') as txFailedMonth,
	  (select count(*) from transactions where status = 'failed' and not txid is null) as txFailedTotal,
    (select count(*) from transactions where status = 'failed' and txid is null and created_at > '${one_day_ago}') as txAbandonedDay,
    (select count(*) from transactions where status = 'failed' and txid is null and created_at > '${one_week_ago}') as txAbandonedWeek,
    (select count(*) from transactions where status = 'failed' and txid is null and created_at > '${one_month_ago}') as txAbandonedMonth,
	  (select count(*) from transactions where status = 'failed' and txid is null) as txAbandonedTotal,
    (select count(*) from transactions where status = 'unprocessed' and created_at > '${one_day_ago}') as txUnprocessedDay,
    (select count(*) from transactions where status = 'unprocessed' and created_at > '${one_week_ago}') as txUnprocessedWeek,
    (select count(*) from transactions where status = 'unprocessed' and created_at > '${one_month_ago}') as txUnprocessedMonth,
	  (select count(*) from transactions where status = 'unprocessed') as txUnprocessedTotal,
    (select count(*) from transactions where status = 'sending' and created_at > '${one_day_ago}') as txSendingDay,
    (select count(*) from transactions where status = 'sending' and created_at > '${one_week_ago}') as txSendingWeek,
    (select count(*) from transactions where status = 'sending' and created_at > '${one_month_ago}') as txSendingMonth,
	  (select count(*) from transactions where status = 'sending') as txSendingTotal,
    (select count(*) from transactions where status = 'unproven' and created_at > '${one_day_ago}') as txUnprovenDay,
    (select count(*) from transactions where status = 'unproven' and created_at > '${one_week_ago}') as txUnprovenWeek,
    (select count(*) from transactions where status = 'unproven' and created_at > '${one_month_ago}') as txUnprovenMonth,
	  (select count(*) from transactions where status = 'unproven') as txUnprovenTotal,
    (select count(*) from transactions where status = 'unsigned' and created_at > '${one_day_ago}') as txUnsignedDay,
    (select count(*) from transactions where status = 'unsigned' and created_at > '${one_week_ago}') as txUnsignedWeek,
    (select count(*) from transactions where status = 'unsigned' and created_at > '${one_month_ago}') as txUnsignedMonth,
	  (select count(*) from transactions where status = 'unsigned') as txUnsignedTotal,
    (select count(*) from transactions where status = 'nosend' and created_at > '${one_day_ago}') as txNosendDay,
    (select count(*) from transactions where status = 'nosend' and created_at > '${one_week_ago}') as txNosendWeek,
    (select count(*) from transactions where status = 'nosend' and created_at > '${one_month_ago}') as txNosendMonth,
	  (select count(*) from transactions where status = 'nosend') as txNosendTotal,
    (select count(*) from transactions where status = 'nonfinal' and created_at > '${one_day_ago}') as txNonfinalDay,
    (select count(*) from transactions where status = 'nonfinal' and created_at > '${one_week_ago}') as txNonfinalWeek,
    (select count(*) from transactions where status = 'nonfinal' and created_at > '${one_month_ago}') as txNonfinalMonth,
	  (select count(*) from transactions where status = 'nonfinal') as txNonfinalTotal,
    (select count(*) from transactions where status = 'unfail' and created_at > '${one_day_ago}') as txUnfailDay,
    (select count(*) from transactions where status = 'unfail' and created_at > '${one_week_ago}') as txUnfailWeek,
    (select count(*) from transactions where status = 'unfail' and created_at > '${one_month_ago}') as txUnfailMonth,
	  (select count(*) from transactions where status = 'unfail') as txUnfailTotal,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 1 and o.created_at > '${one_day_ago}') as satoshisDefaultDay,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 1 and o.created_at > '${one_week_ago}') as satoshisDefaultWeek,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 1 and o.created_at > '${one_month_ago}') as satoshisDefaultMonth,
	  (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 1) as satoshisDefaultTotal,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 0 and not o.basketId is null and o.created_at > '${one_day_ago}') as satoshisOtherDay,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 0 and not o.basketId is null and o.created_at > '${one_week_ago}') as satoshisOtherWeek,
    (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 0 and not o.basketId is null and o.created_at > '${one_month_ago}') as satoshisOtherMonth,
	  (select sum(o.satoshis) from outputs o, transactions t where o.transactionId = t.transactionId and t.status = 'completed' and o.spendable = 1 and o.change = 0 and not o.basketId is null) as satoshisOtherTotal,
    (select count(*) from output_baskets where created_at > '${one_day_ago}') as basketsDay,
    (select count(*) from output_baskets where created_at > '${one_week_ago}') as basketsWeek,
    (select count(*) from output_baskets where created_at > '${one_month_ago}') as basketsMonth,
	  (select count(*) from output_baskets) as basketsTotal,
    (select count(*) from tx_labels where created_at > '${one_day_ago}') as labelsDay,
    (select count(*) from tx_labels where created_at > '${one_week_ago}') as labelsWeek,
    (select count(*) from tx_labels where created_at > '${one_month_ago}') as labelsMonth,
	  (select count(*) from tx_labels) as labelsTotal,
    (select count(*) from output_tags where created_at > '${one_day_ago}') as tagsDay,
    (select count(*) from output_tags where created_at > '${one_week_ago}') as tagsWeek,
    (select count(*) from output_tags where created_at > '${one_month_ago}') as tagsMonth,
	  (select count(*) from output_tags) as tagsTotal
      `);
        const r: AdminStatsResult = {
            monitorStats,
            servicesStats,
            requestedBy: adminIdentityKey,
            when: new Date().toISOString(),
            usersDay,
            usersWeek,
            usersMonth,
            usersTotal,
            transactionsDay,
            transactionsWeek,
            transactionsMonth,
            transactionsTotal,
            txCompletedDay,
            txCompletedWeek,
            txCompletedMonth,
            txCompletedTotal,
            txFailedDay,
            txFailedWeek,
            txFailedMonth,
            txFailedTotal,
            txAbandonedDay,
            txAbandonedWeek,
            txAbandonedMonth,
            txAbandonedTotal,
            txUnprocessedDay,
            txUnprocessedWeek,
            txUnprocessedMonth,
            txUnprocessedTotal,
            txSendingDay,
            txSendingWeek,
            txSendingMonth,
            txSendingTotal,
            txUnprovenDay,
            txUnprovenWeek,
            txUnprovenMonth,
            txUnprovenTotal,
            txUnsignedDay,
            txUnsignedWeek,
            txUnsignedMonth,
            txUnsignedTotal,
            txNosendDay,
            txNosendWeek,
            txNosendMonth,
            txNosendTotal,
            txNonfinalDay,
            txNonfinalWeek,
            txNonfinalMonth,
            txNonfinalTotal,
            txUnfailDay,
            txUnfailWeek,
            txUnfailMonth,
            txUnfailTotal,
            satoshisDefaultDay: Number(satoshisDefaultDay),
            satoshisDefaultWeek: Number(satoshisDefaultWeek),
            satoshisDefaultMonth: Number(satoshisDefaultMonth),
            satoshisDefaultTotal: Number(satoshisDefaultTotal),
            satoshisOtherDay: Number(satoshisOtherDay),
            satoshisOtherWeek: Number(satoshisOtherWeek),
            satoshisOtherMonth: Number(satoshisOtherMonth),
            satoshisOtherTotal: Number(satoshisOtherTotal),
            basketsDay,
            basketsWeek,
            basketsMonth,
            basketsTotal,
            labelsDay,
            labelsWeek,
            labelsMonth,
            labelsTotal,
            tagsDay,
            tagsWeek,
            tagsMonth,
            tagsTotal
        };
        return r;
    }
}
```

See also: [AdminStatsResult](#interface-adminstatsresult), [DBType](#type-dbtype), [StorageKnexOptions](#interface-storageknexoptions), [StorageProvider](#class-storageprovider), [TableCertificate](#interface-tablecertificate), [TableCertificateField](#interface-tablecertificatefield), [TableCertificateX](#interface-tablecertificatex), [TableCommission](#interface-tablecommission), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputTagMap](#interface-tableoutputtagmap), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate), [TableTransaction](#interface-tabletransaction), [TableTxLabel](#interface-tabletxlabel), [TableTxLabelMap](#interface-tabletxlabelmap), [TableUser](#interface-tableuser), [listActions](#function-listactions), [listOutputs](#function-listoutputs), [purgeData](#function-purgedata), [reviewStatus](#function-reviewstatus), [validateEntities](#function-validateentities), [validateEntity](#function-validateentity)

###### Method allocateChangeInput

Finds closest matching available change output to use as input for new transaction.

Transactionally allocate the output such that

```ts
async allocateChangeInput(userId: number, basketId: number, targetSatoshis: number, exactSatoshis: number | undefined, excludeSending: boolean, transactionId: number): Promise<TableOutput | undefined>
```
See also: [TableOutput](#interface-tableoutput)

###### Method countChangeInputs

Counts the outputs for userId in basketId that are spendable: true
AND whose transaction status is one of:
- completed
- unproven
- sending (if excludeSending is false)

```ts
async countChangeInputs(userId: number, basketId: number, excludeSending: boolean): Promise<number>
```

###### Method toDb

Convert the standard optional `TrxToken` parameter into either a direct knex database instance,
or a Knex.Transaction as appropriate.

```ts
toDb(trx?: TrxToken)
```

###### Method validateEntities

Helper to force uniform behavior across database engines.
Use to process all arrays of records with time stamps retreived from database.

```ts
validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[], booleanFields?: string[]): T[]
```

Returns

input `entities` array with contained values validated.

###### Method validateEntity

Helper to force uniform behavior across database engines.
Use to process all individual records with time stamps retreived from database.

```ts
validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[], booleanFields?: string[]): T
```

###### Method validateEntityForInsert

Helper to force uniform behavior across database engines.
Use to process new entities being inserted into the database.

```ts
async validateEntityForInsert<T extends EntityTimeStamp>(entity: T, trx?: TrxToken, dateFields?: string[], booleanFields?: string[]): Promise<any>
```

###### Method validatePartialForUpdate

Helper to force uniform behavior across database engines.
Use to process the update template for entities being updated.

```ts
validatePartialForUpdate<T extends EntityTimeStamp>(update: Partial<T>, dateFields?: string[], booleanFields?: string[]): Partial<T>
```

###### Method verifyReadyForDatabaseAccess

Make sure database is ready for access:

- dateScheme is known

```ts
async verifyReadyForDatabaseAccess(trx?: TrxToken): Promise<DBType>
```
See also: [DBType](#type-dbtype)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageProvider

```ts
export abstract class StorageProvider extends StorageReaderWriter implements WalletStorageProvider {
    isDirty = false;
    _services?: WalletServices;
    feeModel: StorageFeeModel;
    commissionSatoshis: number;
    commissionPubKeyHex?: PubKeyHex;
    maxRecursionDepth?: number;
    static defaultOptions()
    static createStorageBaseOptions(chain: Chain): StorageProviderOptions
    constructor(options: StorageProviderOptions)
    abstract reviewStatus(args: {
        agedLimit: Date;
        trx?: TrxToken;
    }): Promise<{
        log: string;
    }>;
    abstract purgeData(params: PurgeParams, trx?: TrxToken): Promise<PurgeResults>;
    abstract allocateChangeInput(userId: number, basketId: number, targetSatoshis: number, exactSatoshis: number | undefined, excludeSending: boolean, transactionId: number): Promise<TableOutput | undefined>;
    abstract getProvenOrRawTx(txid: string, trx?: TrxToken): Promise<ProvenOrRawTx>;
    abstract getRawTxOfKnownValidTransaction(txid?: string, offset?: number, length?: number, trx?: TrxToken): Promise<number[] | undefined>;
    abstract getLabelsForTransactionId(transactionId?: number, trx?: TrxToken): Promise<TableTxLabel[]>;
    abstract getTagsForOutputId(outputId: number, trx?: TrxToken): Promise<TableOutputTag[]>;
    abstract listActions(auth: AuthId, args: Validation.ValidListActionsArgs): Promise<ListActionsResult>;
    abstract listOutputs(auth: AuthId, args: Validation.ValidListOutputsArgs): Promise<ListOutputsResult>;
    abstract countChangeInputs(userId: number, basketId: number, excludeSending: boolean): Promise<number>;
    async findOutputsByIds(outputIds: number[], trx?: TrxToken): Promise<Record<number, TableOutput>>
    async findStaleMerkleRoots(args: FindStaleMerkleRootsArgs): Promise<string[]>
    async findOutputsByOutpoints(userId: number, outpoints: Array<{
        txid: string;
        vout: number;
    }>, trx?: TrxToken): Promise<Record<string, TableOutput>>
    async findOrInsertOutputBasketsBulk(userId: number, names: string[], trx?: TrxToken): Promise<Record<string, TableOutputBasket>>
    async findOrInsertOutputTagsBulk(userId: number, tags: string[], trx?: TrxToken): Promise<Record<string, TableOutputTag>>
    async sumSpendableSatoshisInBasket(userId: number, basketId: number, excludeSending: boolean, trx?: TrxToken): Promise<number>
    abstract findCertificatesAuth(auth: AuthId, args: FindCertificatesArgs): Promise<TableCertificateX[]>;
    abstract findOutputBasketsAuth(auth: AuthId, args: FindOutputBasketsArgs): Promise<TableOutputBasket[]>;
    abstract findOutputsAuth(auth: AuthId, args: FindOutputsArgs): Promise<TableOutput[]>;
    abstract insertCertificateAuth(auth: AuthId, certificate: TableCertificateX): Promise<number>;
    abstract adminStats(adminIdentityKey: string): Promise<AdminStatsResult>;
    async recentlyActiveUsers(limit = 50, trx?: TrxToken): Promise<TableUser[]>
    override isStorageProvider(): boolean
    setServices(v: WalletServices)
    getServices(): WalletServices
    async abortAction(auth: AuthId, args: AbortActionArgs): Promise<AbortActionResult>
    async internalizeAction(auth: AuthId, args: InternalizeActionArgs): Promise<StorageInternalizeActionResult>
    async getReqsAndBeefToShareWithWorld(txids: string[], knownTxids: string[], trx?: TrxToken): Promise<GetReqsAndBeefResult>
    async mergeReqToBeefToShareExternally(req: TableProvenTxReq, mergeToBeef: Beef, knownTxids: string[], trx?: TrxToken): Promise<void>
    async getProvenOrReq(txid: string, newReq?: TableProvenTxReq, trx?: TrxToken): Promise<StorageProvenOrReq>
    async updateTransactionsStatus(transactionIds: number[], status: TransactionStatus, trx?: TrxToken): Promise<void>
    async updateTransactionStatus(status: TransactionStatus, transactionId?: number, userId?: number, reference?: string, trx?: TrxToken): Promise<void>
    async createAction(auth: AuthId, args: Validation.ValidCreateActionArgs): Promise<StorageCreateActionResult>
    async processAction(auth: AuthId, args: StorageProcessActionArgs): Promise<StorageProcessActionResults>
    async attemptToPostReqsToNetwork(reqs: EntityProvenTxReq[], trx?: TrxToken, logger?: WalletLoggerInterface): Promise<PostReqsToNetworkResult>
    async listCertificates(auth: AuthId, args: Validation.ValidListCertificatesArgs): Promise<ListCertificatesResult>
    async verifyKnownValidTransaction(txid: string, trx?: TrxToken): Promise<boolean>
    async getValidBeefForKnownTxid(txid: string, mergeToBeef?: Beef, trustSelf?: TrustSelf, knownTxids?: string[], trx?: TrxToken, requiredLevels?: number): Promise<Beef>
    async getValidBeefForTxid(txid: string, mergeToBeef?: Beef, trustSelf?: TrustSelf, knownTxids?: string[], trx?: TrxToken, requiredLevels?: number, chainTracker?: ChainTracker, skipInvalidProofs?: boolean): Promise<Beef | undefined>
    async getBeefForTransaction(txid: string, options: StorageGetBeefOptions): Promise<Beef>
    async findMonitorEventById(id: number, trx?: TrxToken): Promise<TableMonitorEvent | undefined>
    async relinquishCertificate(auth: AuthId, args: RelinquishCertificateArgs): Promise<number>
    async relinquishOutput(auth: AuthId, args: RelinquishOutputArgs): Promise<number>
    async processSyncChunk(args: RequestSyncChunkArgs, chunk: SyncChunk): Promise<ProcessSyncChunkResult>
    async updateProvenTxReqWithNewProvenTx(args: UpdateProvenTxReqWithNewProvenTxArgs): Promise<UpdateProvenTxReqWithNewProvenTxResult>
    async confirmSpendableOutputs(): Promise<{
        invalidSpendableOutputs: TableOutput[];
    }>
    async updateProvenTxReqDynamics(id: number, update: Partial<TableProvenTxReqDynamics>, trx?: TrxToken): Promise<number>
    async extendOutput(o: TableOutput, includeBasket = false, includeTags = false, trx?: TrxToken): Promise<TableOutputX>
    async validateOutputScript(o: TableOutput, trx?: TrxToken): Promise<void>
}
```

See also: [AdminStatsResult](#interface-adminstatsresult), [EntityProvenTxReq](#class-entityproventxreq), [GetReqsAndBeefResult](#interface-getreqsandbeefresult), [PostReqsToNetworkResult](#interface-postreqstonetworkresult), [StorageProviderOptions](#interface-storageprovideroptions), [StorageReaderWriter](#class-storagereaderwriter), [TableCertificateX](#interface-tablecertificatex), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputX](#interface-tableoutputx), [TableProvenTxReq](#interface-tableproventxreq), [TableProvenTxReqDynamics](#interface-tableproventxreqdynamics), [TableTxLabel](#interface-tabletxlabel), [TableUser](#interface-tableuser), [attemptToPostReqsToNetwork](#function-attempttopostreqstonetwork), [createAction](#function-createaction), [getBeefForTransaction](#function-getbeeffortransaction), [internalizeAction](#function-internalizeaction), [listActions](#function-listactions), [listCertificates](#function-listcertificates), [listOutputs](#function-listoutputs), [processAction](#function-processaction), [purgeData](#function-purgedata), [reviewStatus](#function-reviewstatus)

###### Method confirmSpendableOutputs

For each spendable output in the 'default' basket of the authenticated user,
verify that the output script, satoshis, vout and txid match that of an output
still in the mempool of at least one service provider.

```ts
async confirmSpendableOutputs(): Promise<{
    invalidSpendableOutputs: TableOutput[];
}>
```
See also: [TableOutput](#interface-tableoutput)

Returns

object with invalidSpendableOutputs array. A good result is an empty array.

###### Method getReqsAndBeefToShareWithWorld

Given an array of transaction txids with current ProvenTxReq ready-to-share status,
lookup their ProvenTxReqApi req records.
For the txids with reqs and status still ready to send construct a single merged beef.

```ts
async getReqsAndBeefToShareWithWorld(txids: string[], knownTxids: string[], trx?: TrxToken): Promise<GetReqsAndBeefResult>
```
See also: [GetReqsAndBeefResult](#interface-getreqsandbeefresult)

###### Method getValidBeefForKnownTxid

Pulls data from storage to build a valid beef for a txid.

Optionally merges the data into an existing beef.
Optionally requires a minimum number of proof levels.

```ts
async getValidBeefForKnownTxid(txid: string, mergeToBeef?: Beef, trustSelf?: TrustSelf, knownTxids?: string[], trx?: TrxToken, requiredLevels?: number): Promise<Beef>
```

###### Method updateProvenTxReqWithNewProvenTx

Handles storage changes when a valid MerklePath and mined block header are found for a ProvenTxReq txid.

Performs the following storage updates (typically):
1. Lookup the exising `ProvenTxReq` record for its rawTx
2. Insert a new ProvenTx record using properties from `args` and rawTx, yielding a new provenTxId
3. Update ProvenTxReq record with status 'completed' and new provenTxId value (and history of status changed)
4. Unpack notify transactionIds from req and update each transaction's status to 'completed', provenTxId value.
5. Update ProvenTxReq history again to record that transactions have been notified.
6. Return results...

Alterations of "typically" to handle:

```ts
async updateProvenTxReqWithNewProvenTx(args: UpdateProvenTxReqWithNewProvenTxArgs): Promise<UpdateProvenTxReqWithNewProvenTxResult>
```

###### Method updateTransactionStatus

For all `status` values besides 'failed', just updates the transaction records status property.

For 'status' of 'failed', attempts to make outputs previously allocated as inputs to this transaction usable again.

```ts
async updateTransactionStatus(status: TransactionStatus, transactionId?: number, userId?: number, reference?: string, trx?: TrxToken): Promise<void>
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageReader

The `StorageReader` abstract class is the base of the concrete wallet storage provider classes.

It is the minimal interface required to read all wallet state records and is the base class for sync readers.

The next class in the heirarchy is the `StorageReaderWriter` which supports sync readers and writers.

The last class in the heirarchy is the `Storage` class which supports all active wallet operations.

The ability to construct a properly configured instance of this class implies authentication.
As such there are no user specific authenticated access checks implied in the implementation of any of these methods.

```ts
export abstract class StorageReader implements sdk.WalletStorageSyncReader {
    chain: sdk.Chain;
    _settings?: TableSettings;
    whenLastAccess?: Date;
    get dbtype(): DBType | undefined
    constructor(options: StorageReaderOptions)
    isAvailable(): boolean
    async makeAvailable(): Promise<TableSettings>
    getSettings(): TableSettings
    isStorageProvider(): boolean
    abstract destroy(): Promise<void>;
    abstract transaction<T>(scope: (trx: sdk.TrxToken) => Promise<T>, trx?: sdk.TrxToken): Promise<T>;
    abstract readSettings(trx?: sdk.TrxToken): Promise<TableSettings>;
    abstract findCertificateFields(args: sdk.FindCertificateFieldsArgs): Promise<TableCertificateField[]>;
    abstract findCertificates(args: sdk.FindCertificatesArgs): Promise<TableCertificateX[]>;
    abstract findCommissions(args: sdk.FindCommissionsArgs): Promise<TableCommission[]>;
    abstract findMonitorEvents(args: sdk.FindMonitorEventsArgs): Promise<TableMonitorEvent[]>;
    abstract findOutputBaskets(args: sdk.FindOutputBasketsArgs): Promise<TableOutputBasket[]>;
    abstract findOutputs(args: sdk.FindOutputsArgs): Promise<TableOutput[]>;
    abstract findOutputTags(args: sdk.FindOutputTagsArgs): Promise<TableOutputTag[]>;
    abstract findSyncStates(args: sdk.FindSyncStatesArgs): Promise<TableSyncState[]>;
    abstract findTransactions(args: sdk.FindTransactionsArgs): Promise<TableTransaction[]>;
    abstract findTxLabels(args: sdk.FindTxLabelsArgs): Promise<TableTxLabel[]>;
    abstract findUsers(args: sdk.FindUsersArgs): Promise<TableUser[]>;
    abstract countCertificateFields(args: sdk.FindCertificateFieldsArgs): Promise<number>;
    abstract countCertificates(args: sdk.FindCertificatesArgs): Promise<number>;
    abstract countCommissions(args: sdk.FindCommissionsArgs): Promise<number>;
    abstract countMonitorEvents(args: sdk.FindMonitorEventsArgs): Promise<number>;
    abstract countOutputBaskets(args: sdk.FindOutputBasketsArgs): Promise<number>;
    abstract countOutputs(args: sdk.FindOutputsArgs): Promise<number>;
    abstract countOutputTags(args: sdk.FindOutputTagsArgs): Promise<number>;
    abstract countSyncStates(args: sdk.FindSyncStatesArgs): Promise<number>;
    abstract countTransactions(args: sdk.FindTransactionsArgs): Promise<number>;
    abstract countTxLabels(args: sdk.FindTxLabelsArgs): Promise<number>;
    abstract countUsers(args: sdk.FindUsersArgs): Promise<number>;
    abstract getProvenTxsForUser(args: sdk.FindForUserSincePagedArgs): Promise<TableProvenTx[]>;
    abstract getProvenTxReqsForUser(args: sdk.FindForUserSincePagedArgs): Promise<TableProvenTxReq[]>;
    abstract getTxLabelMapsForUser(args: sdk.FindForUserSincePagedArgs): Promise<TableTxLabelMap[]>;
    abstract getOutputTagMapsForUser(args: sdk.FindForUserSincePagedArgs): Promise<TableOutputTagMap[]>;
    async findUserByIdentityKey(key: string): Promise<TableUser | undefined>
    async getSyncChunk(args: sdk.RequestSyncChunkArgs): Promise<sdk.SyncChunk>
    validateEntityDate(date: Date | string | number): Date | string
    validateOptionalEntityDate(date: Date | string | number | null | undefined, useNowAsDefault?: boolean): Date | string | undefined
    validateDate(date: Date | string | number): Date
    validateOptionalDate(date: Date | string | number | null | undefined): Date | undefined
    validateDateForWhere(date: Date | string | number): Date | string | number
}
```

See also: [DBType](#type-dbtype), [StorageReaderOptions](#interface-storagereaderoptions), [TableCertificateField](#interface-tablecertificatefield), [TableCertificateX](#interface-tablecertificatex), [TableCommission](#interface-tablecommission), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputTagMap](#interface-tableoutputtagmap), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableSyncState](#interface-tablesyncstate), [TableTransaction](#interface-tabletransaction), [TableTxLabel](#interface-tabletxlabel), [TableTxLabelMap](#interface-tabletxlabelmap), [TableUser](#interface-tableuser), [getSyncChunk](#function-getsyncchunk), [validateDate](#function-validatedate)

###### Method validateOptionalEntityDate

```ts
validateOptionalEntityDate(date: Date | string | number | null | undefined, useNowAsDefault?: boolean): Date | string | undefined
```

Argument Details

+ **useNowAsDefault**
  + if true and date is null or undefiend, set to current time.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageReaderWriter

```ts
export abstract class StorageReaderWriter extends StorageReader {
    constructor(options: StorageReaderWriterOptions)
    abstract dropAllData(): Promise<void>;
    abstract migrate(storageName: string, storageIdentityKey: string): Promise<string>;
    abstract findOutputTagMaps(args: FindOutputTagMapsArgs): Promise<TableOutputTagMap[]>;
    abstract findProvenTxReqs(args: FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>;
    abstract findProvenTxs(args: FindProvenTxsArgs): Promise<TableProvenTx[]>;
    abstract findTxLabelMaps(args: FindTxLabelMapsArgs): Promise<TableTxLabelMap[]>;
    abstract findStaleMerkleRoots(args: FindStaleMerkleRootsArgs): Promise<string[]>;
    abstract countOutputTagMaps(args: FindOutputTagMapsArgs): Promise<number>;
    abstract countProvenTxReqs(args: FindProvenTxReqsArgs): Promise<number>;
    abstract countProvenTxs(args: FindProvenTxsArgs): Promise<number>;
    abstract countTxLabelMaps(args: FindTxLabelMapsArgs): Promise<number>;
    abstract insertCertificate(certificate: TableCertificate, trx?: TrxToken): Promise<number>;
    abstract insertCertificateField(certificateField: TableCertificateField, trx?: TrxToken): Promise<void>;
    abstract insertCommission(commission: TableCommission, trx?: TrxToken): Promise<number>;
    abstract insertMonitorEvent(event: TableMonitorEvent, trx?: TrxToken): Promise<number>;
    abstract insertOutput(output: TableOutput, trx?: TrxToken): Promise<number>;
    abstract insertOutputBasket(basket: TableOutputBasket, trx?: TrxToken): Promise<number>;
    abstract insertOutputTag(tag: TableOutputTag, trx?: TrxToken): Promise<number>;
    abstract insertOutputTagMap(tagMap: TableOutputTagMap, trx?: TrxToken): Promise<void>;
    abstract insertProvenTx(tx: TableProvenTx, trx?: TrxToken): Promise<number>;
    abstract insertProvenTxReq(tx: TableProvenTxReq, trx?: TrxToken): Promise<number>;
    abstract insertSyncState(syncState: TableSyncState, trx?: TrxToken): Promise<number>;
    abstract insertTransaction(tx: TableTransaction, trx?: TrxToken): Promise<number>;
    abstract insertTxLabel(label: TableTxLabel, trx?: TrxToken): Promise<number>;
    abstract insertTxLabelMap(labelMap: TableTxLabelMap, trx?: TrxToken): Promise<void>;
    abstract insertUser(user: TableUser, trx?: TrxToken): Promise<number>;
    abstract updateCertificate(id: number, update: Partial<TableCertificate>, trx?: TrxToken): Promise<number>;
    abstract updateCertificateField(certificateId: number, fieldName: string, update: Partial<TableCertificateField>, trx?: TrxToken): Promise<number>;
    abstract updateCommission(id: number, update: Partial<TableCommission>, trx?: TrxToken): Promise<number>;
    abstract updateMonitorEvent(id: number, update: Partial<TableMonitorEvent>, trx?: TrxToken): Promise<number>;
    abstract updateOutput(id: number, update: Partial<TableOutput>, trx?: TrxToken): Promise<number>;
    abstract updateOutputBasket(id: number, update: Partial<TableOutputBasket>, trx?: TrxToken): Promise<number>;
    abstract updateOutputTag(id: number, update: Partial<TableOutputTag>, trx?: TrxToken): Promise<number>;
    abstract updateOutputTagMap(outputId: number, tagId: number, update: Partial<TableOutputTagMap>, trx?: TrxToken): Promise<number>;
    abstract updateProvenTx(id: number, update: Partial<TableProvenTx>, trx?: TrxToken): Promise<number>;
    abstract updateProvenTxReq(id: number | number[], update: Partial<TableProvenTxReq>, trx?: TrxToken): Promise<number>;
    abstract updateSyncState(id: number, update: Partial<TableSyncState>, trx?: TrxToken): Promise<number>;
    abstract updateTransaction(id: number | number[], update: Partial<TableTransaction>, trx?: TrxToken): Promise<number>;
    abstract updateTxLabel(id: number, update: Partial<TableTxLabel>, trx?: TrxToken): Promise<number>;
    abstract updateTxLabelMap(transactionId: number, txLabelId: number, update: Partial<TableTxLabelMap>, trx?: TrxToken): Promise<number>;
    abstract updateUser(id: number, update: Partial<TableUser>, trx?: TrxToken): Promise<number>;
    async setActive(auth: AuthId, newActiveStorageIdentityKey: string): Promise<number>
    async findCertificateById(id: number, trx?: TrxToken): Promise<TableCertificate | undefined>
    async findCommissionById(id: number, trx?: TrxToken): Promise<TableCommission | undefined>
    async findOutputById(id: number, trx?: TrxToken, noScript?: boolean): Promise<TableOutput | undefined>
    async findOutputBasketById(id: number, trx?: TrxToken): Promise<TableOutputBasket | undefined>
    async findProvenTxById(id: number, trx?: TrxToken | undefined): Promise<TableProvenTx | undefined>
    async findProvenTxReqById(id: number, trx?: TrxToken | undefined): Promise<TableProvenTxReq | undefined>
    async findSyncStateById(id: number, trx?: TrxToken): Promise<TableSyncState | undefined>
    async findTransactionById(id: number, trx?: TrxToken, noRawTx?: boolean): Promise<TableTransaction | undefined>
    async findTxLabelById(id: number, trx?: TrxToken): Promise<TableTxLabel | undefined>
    async findOutputTagById(id: number, trx?: TrxToken): Promise<TableOutputTag | undefined>
    async findUserById(id: number, trx?: TrxToken): Promise<TableUser | undefined>
    async findOrInsertUser(identityKey: string, trx?: TrxToken): Promise<{
        user: TableUser;
        isNew: boolean;
    }>
    async findOrInsertTransaction(newTx: TableTransaction, trx?: TrxToken): Promise<{
        tx: TableTransaction;
        isNew: boolean;
    }>
    async findOrInsertOutputBasket(userId: number, name: string, trx?: TrxToken): Promise<TableOutputBasket>
    async findOrInsertTxLabel(userId: number, label: string, trx?: TrxToken): Promise<TableTxLabel>
    async findOrInsertTxLabelMap(transactionId: number, txLabelId: number, trx?: TrxToken): Promise<TableTxLabelMap>
    async findOrInsertOutputTag(userId: number, tag: string, trx?: TrxToken): Promise<TableOutputTag>
    async findOrInsertOutputTagMap(outputId: number, outputTagId: number, trx?: TrxToken): Promise<TableOutputTagMap>
    async findOrInsertSyncStateAuth(auth: AuthId, storageIdentityKey: string, storageName: string): Promise<{
        syncState: TableSyncState;
        isNew: boolean;
    }>
    async findOrInsertProvenTxReq(newReq: TableProvenTxReq, trx?: TrxToken): Promise<{
        req: TableProvenTxReq;
        isNew: boolean;
    }>
    async findOrInsertProvenTx(newProven: TableProvenTx, trx?: TrxToken): Promise<{
        proven: TableProvenTx;
        isNew: boolean;
    }>
    abstract processSyncChunk(args: RequestSyncChunkArgs, chunk: SyncChunk): Promise<ProcessSyncChunkResult>;
    async tagOutput(partial: Partial<TableOutput>, tag: string, trx?: TrxToken): Promise<void>
}
```

See also: [StorageReader](#class-storagereader), [StorageReaderWriterOptions](#interface-storagereaderwriteroptions), [TableCertificate](#interface-tablecertificate), [TableCertificateField](#interface-tablecertificatefield), [TableCommission](#interface-tablecommission), [TableMonitorEvent](#interface-tablemonitorevent), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableOutputTag](#interface-tableoutputtag), [TableOutputTagMap](#interface-tableoutputtagmap), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSyncState](#interface-tablesyncstate), [TableTransaction](#interface-tabletransaction), [TableTxLabel](#interface-tabletxlabel), [TableTxLabelMap](#interface-tabletxlabelmap), [TableUser](#interface-tableuser)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageServer

```ts
export class StorageServer {
    constructor(storage: StorageProvider, options: WalletStorageServerOptions)
    server: any;
    public start(): void
    public async close(): Promise<void>
    validateDate(date: Date | string | number): Date
    validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[]): T
    validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[]): T[]
}
```

See also: [StorageProvider](#class-storageprovider), [WalletStorageServerOptions](#interface-walletstorageserveroptions), [validateDate](#function-validatedate), [validateEntities](#function-validateentities), [validateEntity](#function-validateentity)

###### Method validateEntities

Helper to force uniform behavior across database engines.
Use to process all arrays of records with time stamps retreived from database.

```ts
validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[]): T[]
```

Returns

input `entities` array with contained values validated.

###### Method validateEntity

Helper to force uniform behavior across database engines.
Use to process all individual records with time stamps retreived from database.

```ts
validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[]): T
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: StorageSyncReader

The `StorageSyncReader` non-abstract class must be used when authentication checking access to the methods of a `StorageBaseReader` is required.

Constructed from an `auth` object that must minimally include the authenticated user's identityKey,
and the `StorageBaseReader` to be protected.

```ts
export class StorageSyncReader implements sdk.WalletStorageSyncReader {
    constructor(public auth: sdk.AuthId, public storage: StorageReader)
    async makeAvailable(): Promise<TableSettings>
    async destroy(): Promise<void>
    async getSyncChunk(args: sdk.RequestSyncChunkArgs): Promise<sdk.SyncChunk>
}
```

See also: [StorageReader](#class-storagereader), [TableSettings](#interface-tablesettings), [getSyncChunk](#function-getsyncchunk)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Class: WalletStorageManager

The `WalletStorageManager` class delivers authentication checking storage access to the wallet.

If manages multiple `StorageBase` derived storage services: one actice, the rest as backups.

Of the storage services, one is 'active' at any one time.
On startup, and whenever triggered by the wallet, `WalletStorageManager` runs a syncrhonization sequence:

1. While synchronizing, all other access to storage is blocked waiting.
2. The active service is confirmed, potentially triggering a resolution process if there is disagreement.
3. Changes are pushed from the active storage service to each inactive, backup service.

Some storage services do not support multiple writers. `WalletStorageManager` manages wait-blocking write requests
for these services.

```ts
export class WalletStorageManager implements sdk.WalletStorage {
    _stores: ManagedStorage[] = [];
    _isAvailable: boolean = false;
    _active?: ManagedStorage;
    _backups?: ManagedStorage[];
    _conflictingActives?: ManagedStorage[];
    _authId: sdk.AuthId;
    _services?: sdk.WalletServices;
    constructor(identityKey: string, active?: sdk.WalletStorageProvider, backups?: sdk.WalletStorageProvider[])
    isStorageProvider(): boolean
    isAvailable(): boolean
    get isActiveEnabled(): boolean
    canMakeAvailable(): boolean
    async makeAvailable(): Promise<TableSettings>
    async getAuth(mustBeActive?: boolean): Promise<sdk.AuthId>
    async getUserId(): Promise<number>
    getActive(): sdk.WalletStorageProvider
    getActiveSettings(): TableSettings
    getActiveUser(): TableUser
    getActiveStore(): string
    getActiveStoreName(): string
    getBackupStores(): string[]
    getConflictingStores(): string[]
    getAllStores(): string[]
    async runAsWriter<R>(writer: (active: sdk.WalletStorageWriter) => Promise<R>): Promise<R>
    async runAsReader<R>(reader: (active: sdk.WalletStorageReader) => Promise<R>): Promise<R>
    async runAsSync<R>(sync: (active: sdk.WalletStorageSync) => Promise<R>, activeSync?: sdk.WalletStorageSync): Promise<R>
    async runAsStorageProvider<R>(sync: (active: StorageProvider) => Promise<R>): Promise<R>
    isActiveStorageProvider(): boolean
    async addWalletStorageProvider(provider: sdk.WalletStorageProvider): Promise<void>
    setServices(v: sdk.WalletServices)
    getServices(): sdk.WalletServices
    getSettings(): TableSettings
    async migrate(storageName: string, storageIdentityKey: string): Promise<string>
    async destroy(): Promise<void>
    async findOrInsertUser(identityKey: string): Promise<{
        user: TableUser;
        isNew: boolean;
    }>
    async abortAction(args: AbortActionArgs): Promise<AbortActionResult>
    async createAction(vargs: Validation.ValidCreateActionArgs): Promise<sdk.StorageCreateActionResult>
    async internalizeAction(args: InternalizeActionArgs): Promise<sdk.StorageInternalizeActionResult>
    async relinquishCertificate(args: RelinquishCertificateArgs): Promise<number>
    async relinquishOutput(args: RelinquishOutputArgs): Promise<number>
    async processAction(args: sdk.StorageProcessActionArgs): Promise<sdk.StorageProcessActionResults>
    async insertCertificate(certificate: TableCertificate): Promise<number>
    async listActions(args: ListActionsArgs): Promise<ListActionsResult>
    async listCertificates(args: Validation.ValidListCertificatesArgs): Promise<ListCertificatesResult>
    async listOutputs(args: ListOutputsArgs | Validation.ValidListOutputsArgs): Promise<ListOutputsResult>
    async findCertificates(args: sdk.FindCertificatesArgs): Promise<TableCertificateX[]>
    async findOutputBaskets(args: sdk.FindOutputBasketsArgs): Promise<TableOutputBasket[]>
    async findOutputs(args: sdk.FindOutputsArgs): Promise<TableOutput[]>
    async findProvenTxReqs(args: sdk.FindProvenTxReqsArgs): Promise<TableProvenTxReq[]>
    async reproveHeader(deactivatedHash: string): Promise<sdk.ReproveHeaderResult>
    async reproveHeightMerkleRoot(height: number, staleMerkleRoot: string): Promise<sdk.ReproveHeaderResult>
    async reproveProven(ptx: TableProvenTx, noUpdate?: boolean): Promise<sdk.ReproveProvenResult>
    async syncFromReader(identityKey: string, reader: sdk.WalletStorageSyncReader, activeSync?: sdk.WalletStorageSync, log: string = ""): Promise<{
        inserts: number;
        updates: number;
        log: string;
    }>
    async syncToWriter(auth: sdk.AuthId, writer: sdk.WalletStorageProvider, activeSync?: sdk.WalletStorageSync, log: string = "", progLog?: (s: string) => string): Promise<{
        inserts: number;
        updates: number;
        log: string;
    }>
    async updateBackups(activeSync?: sdk.WalletStorageSync, progLog?: (s: string) => string): Promise<string>
    async setActive(storageIdentityKey: string, progLog?: (s: string) => string): Promise<string>
    getStoreEndpointURL(store: ManagedStorage): string | undefined
    getStores(): sdk.WalletStorageInfo[]
}
```

See also: [StorageProvider](#class-storageprovider), [TableCertificate](#interface-tablecertificate), [TableCertificateX](#interface-tablecertificatex), [TableOutput](#interface-tableoutput), [TableOutputBasket](#interface-tableoutputbasket), [TableProvenTx](#interface-tableproventx), [TableProvenTxReq](#interface-tableproventxreq), [TableSettings](#interface-tablesettings), [TableUser](#interface-tableuser), [createAction](#function-createaction), [internalizeAction](#function-internalizeaction), [listActions](#function-listactions), [listCertificates](#function-listcertificates), [listOutputs](#function-listoutputs), [processAction](#function-processaction)

###### Constructor

Creates a new WalletStorageManager with the given identityKey and optional active and backup storage providers.

```ts
constructor(identityKey: string, active?: sdk.WalletStorageProvider, backups?: sdk.WalletStorageProvider[])
```

Argument Details

+ **identityKey**
  + The identity key of the user for whom this wallet is being managed.
+ **active**
  + An optional active storage provider. If not provided, no active storage will be set.
+ **backups**
  + An optional array of backup storage providers. If not provided, no backups will be set.

###### Property _active

The current active store which is only enabled if the store's user record activeStorage property matches its settings record storageIdentityKey property

```ts
_active?: ManagedStorage
```

###### Property _authId

identityKey is always valid, userId and isActive are valid only if _isAvailable

```ts
_authId: sdk.AuthId
```

###### Property _backups

Stores to which state is pushed by updateBackups.

```ts
_backups?: ManagedStorage[]
```

###### Property _conflictingActives

Stores whose user record activeStorage property disagrees with the active store's user record activeStorage property.

```ts
_conflictingActives?: ManagedStorage[]
```

###### Property _isAvailable

True if makeAvailable has been run and access to managed stores (active) is allowed

```ts
_isAvailable: boolean = false
```

###### Property _services

Configured services if any. If valid, shared with stores (which may ignore it).

```ts
_services?: sdk.WalletServices
```

###### Property _stores

All configured stores including current active, backups, and conflicting actives.

```ts
_stores: ManagedStorage[] = []
```

###### Method canMakeAvailable

```ts
canMakeAvailable(): boolean
```

Returns

true if at least one WalletStorageProvider has been added.

###### Method isActiveStorageProvider

```ts
isActiveStorageProvider(): boolean
```

Returns

true if the active `WalletStorageProvider` also implements `StorageProvider`

###### Method reproveHeader

For each proven_txs record currently sourcing its transaction merkle proof from the given deactivated header,
attempt to reprove the transaction against the current chain,
updating the proven_txs record if a new valid proof is found.

```ts
async reproveHeader(deactivatedHash: string): Promise<sdk.ReproveHeaderResult>
```

Argument Details

+ **deactivatedHash**
  + An orphaned header than may have served as a proof source for proven_txs records.

###### Method reproveHeightMerkleRoot

For all proven_txs records at the given height currently tied to the given stale merkleRoot,
attempt to reprove them against the current chain and update proof data if new valid proofs are found.

This is intended for backup auditing of recent heights after the primary reorg event path has run.

```ts
async reproveHeightMerkleRoot(height: number, staleMerkleRoot: string): Promise<sdk.ReproveHeaderResult>
```

###### Method runAsSync

```ts
async runAsSync<R>(sync: (active: sdk.WalletStorageSync) => Promise<R>, activeSync?: sdk.WalletStorageSync): Promise<R>
```

Argument Details

+ **sync**
  + the function to run with sync access lock
+ **activeSync**
  + from chained sync functions, active storage already held under sync access lock.

###### Method setActive

Updates backups and switches to new active storage provider from among current backup providers.

Also resolves conflicting actives.

```ts
async setActive(storageIdentityKey: string, progLog?: (s: string) => string): Promise<string>
```

Argument Details

+ **storageIdentityKey**
  + of current backup storage provider that is to become the new active provider.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
#### Functions

| | | |
| --- | --- | --- |
| [applyOutputScriptMetadata](#function-applyoutputscriptmetadata) | [matchesOutputBasketPartial](#function-matchesoutputbasketpartial) | [transactionOutputSize](#function-transactionoutputsize) |
| [attemptToPostReqsToNetwork](#function-attempttopostreqstonetwork) | [matchesOutputPartial](#function-matchesoutputpartial) | [transactionSize](#function-transactionsize) |
| [classifyReqStatus](#function-classifyreqstatus) | [matchesOutputTagMapPartial](#function-matchesoutputtagmappartial) | [updateReqsFromAggregateResults](#function-updatereqsfromaggregateresults) |
| [createAction](#function-createaction) | [matchesOutputTagPartial](#function-matchesoutputtagpartial) | [upgradeAllStoresV1](#function-upgradeallstoresv1) |
| [createStorageServiceChargeScript](#function-createstorageservicechargescript) | [matchesProvenTxPartial](#function-matchesproventxpartial) | [upgradeCertificateFields](#function-upgradecertificatefields) |
| [createSyncMap](#function-createsyncmap) | [matchesProvenTxReqPartial](#function-matchesproventxreqpartial) | [upgradeCertificates](#function-upgradecertificates) |
| [dateMatches](#function-datematches) | [matchesSyncStatePartial](#function-matchessyncstatepartial) | [upgradeCommissions](#function-upgradecommissions) |
| [determineDBType](#function-determinedbtype) | [matchesTransactionPartial](#function-matchestransactionpartial) | [upgradeMonitorEvents](#function-upgrademonitorevents) |
| [generateChangeSdk](#function-generatechangesdk) | [matchesTxLabelMapPartial](#function-matchestxlabelmappartial) | [upgradeOutputBaskets](#function-upgradeoutputbaskets) |
| [generateChangeSdkMakeStorage](#function-generatechangesdkmakestorage) | [matchesTxLabelPartial](#function-matchestxlabelpartial) | [upgradeOutputTags](#function-upgradeoutputtags) |
| [getBeefForTransaction](#function-getbeeffortransaction) | [mergeInputBeefs](#function-mergeinputbeefs) | [upgradeOutputTagsMap](#function-upgradeoutputtagsmap) |
| [getListOutputsSpecOp](#function-getlistoutputsspecop) | [mergeInputsIntoBeef](#function-mergeinputsintobeef) | [upgradeOutputs](#function-upgradeoutputs) |
| [getSyncChunk](#function-getsyncchunk) | [notifyTransactionsOfProof](#function-notifytransactionsofproof) | [upgradeProvenTxReqs](#function-upgradeproventxreqs) |
| [hashOutputLockingScript](#function-hashoutputlockingscript) | [offsetPrivKey](#function-offsetprivkey) | [upgradeProvenTxs](#function-upgradeproventxs) |
| [internalizeAction](#function-internalizeaction) | [offsetPubKey](#function-offsetpubkey) | [upgradeSyncStates](#function-upgradesyncstates) |
| [keyOffsetToHashedSecret](#function-keyoffsettohashedsecret) | [partitionActionLabels](#function-partitionactionlabels) | [upgradeTransactions](#function-upgradetransactions) |
| [listActions](#function-listactions) | [processAction](#function-processaction) | [upgradeTxLabels](#function-upgradetxlabels) |
| [listActionsIdb](#function-listactionsidb) | [purgeData](#function-purgedata) | [upgradeTxLabelsMap](#function-upgradetxlabelsmap) |
| [listCertificates](#function-listcertificates) | [purgeDataIdb](#function-purgedataidb) | [upgradeUsers](#function-upgradeusers) |
| [listOutputs](#function-listoutputs) | [redeemServiceCharges](#function-redeemservicecharges) | [validateDate](#function-validatedate) |
| [listOutputsIdb](#function-listoutputsidb) | [renderAdminPage](#function-renderadminpage) | [validateEntities](#function-validateentities) |
| [lockScriptWithKeyOffsetFromPubKey](#function-lockscriptwithkeyoffsetfrompubkey) | [reviewStatus](#function-reviewstatus) | [validateEntity](#function-validateentity) |
| [markStaleInputsAsSpent](#function-markstaleinputsasspent) | [reviewStatusIdb](#function-reviewstatusidb) | [validateGenerateChangeSdkParams](#function-validategeneratechangesdkparams) |
| [matchesCertificateFieldPartial](#function-matchescertificatefieldpartial) | [setDisableDoubleSpendCheckForTest](#function-setdisabledoublespendcheckfortest) | [validateGenerateChangeSdkResult](#function-validategeneratechangesdkresult) |
| [matchesCertificatePartial](#function-matchescertificatepartial) | [shareReqsWithWorld](#function-sharereqswithworld) | [validateStorageFeeModel](#function-validatestoragefeemodel) |
| [matchesCommissionPartial](#function-matchescommissionpartial) | [summarizePostBeefProviderAttemptsForTxid](#function-summarizepostbeefproviderattemptsfortxid) | [validateSyncChunkEntities](#function-validatesyncchunkentities) |
| [matchesMonitorEventPartial](#function-matchesmonitoreventpartial) | [transactionInputSize](#function-transactioninputsize) | [varUintSize](#function-varuintsize) |

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

##### Function: applyOutputScriptMetadata

```ts
export function applyOutputScriptMetadata<T extends Partial<TableOutput>>(output: T): T
```

See also: [TableOutput](#interface-tableoutput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: attemptToPostReqsToNetwork

Attempt to post one or more `ProvenTxReq` with status 'unsent'
to the bitcoin network.

```ts
export async function attemptToPostReqsToNetwork(storage: StorageProvider, reqs: EntityProvenTxReq[], trx?: sdk.TrxToken, logger?: WalletLoggerInterface): Promise<PostReqsToNetworkResult>
```

See also: [EntityProvenTxReq](#class-entityproventxreq), [PostReqsToNetworkResult](#interface-postreqstonetworkresult), [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: classifyReqStatus

Classify a ProvenTxReq status into beef-sharing lifecycle status.
Mutates `d` in place.

```ts
export function classifyReqStatus(d: GetReqsAndBeefDetail, req: TableProvenTxReq): void
```

See also: [GetReqsAndBeefDetail](#interface-getreqsandbeefdetail), [TableProvenTxReq](#interface-tableproventxreq)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: createAction

```ts
export async function createAction(storage: StorageProvider, auth: AuthId, vargs: Validation.ValidCreateActionArgs, originator?: OriginatorDomainNameStringUnder250Bytes): Promise<StorageCreateActionResult>
```

See also: [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: createStorageServiceChargeScript

```ts
export function createStorageServiceChargeScript(pubKeyHex: PubKeyHex): {
    script: string;
    keyOffset: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: createSyncMap

```ts
export function createSyncMap(): SyncMap
```

See also: [SyncMap](#interface-syncmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: dateMatches

```ts
export function dateMatches(a: Date | undefined, b: Date | undefined): boolean
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: determineDBType

```ts
export async function determineDBType(knex: Knex<any, any[]>): Promise<DBType>
```

See also: [DBType](#type-dbtype)

Returns

connected database engine variant

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: generateChangeSdk

Simplifications:
 - only support one change type with fixed length scripts.
 - only support satsPerKb fee model.

Confirms for each availbleChange output that it remains available as they are allocated and selects alternate if not.

```ts
export async function generateChangeSdk(params: GenerateChangeSdkParams, allocateChangeInput: (targetSatoshis: number, exactSatoshis?: number) => Promise<GenerateChangeSdkChangeInput | undefined>, releaseChangeInput: (outputId: number) => Promise<void>, logger?: WalletLoggerInterface): Promise<GenerateChangeSdkResult>
```

See also: [GenerateChangeSdkChangeInput](#interface-generatechangesdkchangeinput), [GenerateChangeSdkParams](#interface-generatechangesdkparams), [GenerateChangeSdkResult](#interface-generatechangesdkresult)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: generateChangeSdkMakeStorage

```ts
export function generateChangeSdkMakeStorage(availableChange: GenerateChangeSdkChangeInput[]): {
    allocateChangeInput: (targetSatoshis: number, exactSatoshis?: number) => Promise<GenerateChangeSdkChangeInput | undefined>;
    releaseChangeInput: (outputId: number) => Promise<void>;
    getLog: () => string;
}
```

See also: [GenerateChangeSdkChangeInput](#interface-generatechangesdkchangeinput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: getBeefForTransaction

Creates a `Beef` to support the validity of a transaction identified by its `txid`.

`storage` is used to retrieve proven transactions and their merkle paths,
or proven_tx_req record with beef of external inputs (internal inputs meged by recursion).
Otherwise external services are used.

`options.maxRecursionDepth` can be set to prevent overly deep chained dependencies. Will throw ERR_EXTSVS_ENVELOPE_DEPTH if exceeded.

If `trustSelf` is true, a partial `Beef` will be returned where transactions known by `storage` to
be valid by verified proof are represented solely by 'txid'.

If `knownTxids` is defined, any 'txid' required by the `Beef` that appears in the array is represented solely as a 'known' txid.

```ts
export async function getBeefForTransaction(storage: StorageProvider, txid: string, options: StorageGetBeefOptions): Promise<Beef>
```

See also: [StorageProvider](#class-storageprovider)

Argument Details

+ **storage**
  + the chain on which txid exists.
+ **txid**
  + the transaction hash for which an envelope is requested.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: getListOutputsSpecOp

Check basket and tags arguments passed to listOutputs to determine if they trigger a special operation execution mode.

```ts
export function getListOutputsSpecOp(basket: string, tags: string[]): {
    specOp: ListOutputsSpecOp | undefined;
    basket?: string;
    tags: string[];
}
```

See also: [ListOutputsSpecOp](#interface-listoutputsspecop)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: getSyncChunk

Gets the next sync chunk of updated data from un-remoted storage (could be using a remote DB connection).

```ts
export async function getSyncChunk(storage: StorageReader, args: RequestSyncChunkArgs): Promise<SyncChunk>
```

See also: [StorageReader](#class-storagereader)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: hashOutputLockingScript

```ts
export function hashOutputLockingScript(lockingScript: number[]): string
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: internalizeAction

Internalize Action allows a wallet to take ownership of outputs in a pre-existing transaction.
The transaction may, or may not already be known to both the storage and user.

Two types of outputs are handled: "wallet payments" and "basket insertions".

A "basket insertion" output is considered a custom output and has no effect on the wallet's "balance".

A "wallet payment" adds an outputs value to the wallet's change "balance". These outputs are assigned to the "default" basket.

Processing starts with simple validation and then checks for a pre-existing transaction.
If the transaction is already known to the user, then the outputs are reviewed against the existing outputs treatment,
and merge rules are added to the arguments passed to the storage layer.
The existing transaction must be in the 'unproven' or 'completed' status. Any other status is an error.

When the transaction already exists, the description is updated. The isOutgoing sense is not changed.

"basket insertion" Merge Rules:
1. The "default" basket may not be specified as the insertion basket.
2. A change output in the "default" basket may not be target of an insertion into a different basket.
3. These baskets do not affect the wallet's balance and are typed "custom".

"wallet payment" Merge Rules:
1. Targetting an existing change "default" basket output results in a no-op. No error. No alterations made.
2. Targetting a previously "custom" non-change output converts it into a change output. This alters the transaction's `satoshis`, and the wallet balance.

```ts
export async function internalizeAction(storage: StorageProvider, auth: AuthId, args: InternalizeActionArgs): Promise<StorageInternalizeActionResult>
```

See also: [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: keyOffsetToHashedSecret

```ts
export function keyOffsetToHashedSecret(pub: PublicKey, keyOffset?: string): {
    hashedSecret: BigNumber;
    keyOffset: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: listActions

```ts
export async function listActions(storage: StorageKnex, auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
```

See also: [StorageKnex](#class-storageknex)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: listActionsIdb

```ts
export async function listActionsIdb(storage: StorageIdb, auth: AuthId, vargs: Validation.ValidListActionsArgs): Promise<ListActionsResult>
```

See also: [StorageIdb](#class-storageidb)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: listCertificates

```ts
export async function listCertificates(storage: StorageProvider, auth: AuthId, vargs: Validation.ValidListCertificatesArgs, originator?: OriginatorDomainNameStringUnder250Bytes): Promise<ListCertificatesResult>
```

See also: [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: listOutputs

```ts
export async function listOutputs(dsk: StorageKnex, auth: AuthId, vargs: Validation.ValidListOutputsArgs, originator?: OriginatorDomainNameStringUnder250Bytes): Promise<ListOutputsResult>
```

See also: [StorageKnex](#class-storageknex)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: listOutputsIdb

```ts
export async function listOutputsIdb(storage: StorageIdb, auth: AuthId, vargs: Validation.ValidListOutputsArgs, originator?: OriginatorDomainNameStringUnder250Bytes): Promise<ListOutputsResult>
```

See also: [StorageIdb](#class-storageidb)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: lockScriptWithKeyOffsetFromPubKey

```ts
export function lockScriptWithKeyOffsetFromPubKey(pubKey: string, keyOffset?: string): {
    script: string;
    keyOffset: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: markStaleInputsAsSpent

After any failed broadcast (doubleSpend, invalidTx, etc.), query each
consumed-input outpoint of the failed transaction against on-chain
UTXO state. For inputs the chain authoritatively confirms are spent
(i.e. NOT a UTXO), update the corresponding wallet basket entry to
spendable=false.

Background: `updateTransactionStatus(failed)` optimistically restores
all consumed-input outputs to spendable=true so the user can retry
with the same inputs. For some failures (genuine doubleSpend, or any
'missing-inputs' outcome where the input has been spent on chain by
a different transaction), restoration is incorrect — the input is
gone and restoring it produces an infinite missing-inputs loop on
the next createAction → broadcast cycle. Apps cannot evict from the
default basket on app-isolated wallets (admin-only policy), so this
self-heal must run inside the wallet.

Different broadcasters classify the same on-chain reality differently
(ARC → doubleSpend, WhatsOnChain/Bitails → invalidTx via
'missing-inputs'); this helper is broadcaster-agnostic because its
decision is based on services.isUtxo, not the aggregate failure
classification.

Pre-broadcast races where concurrent createActions reach the same
UTXO across separate app processes are out of scope; see PR
description.

Conservatively scoped:
  - Only inputs found in the failing user's basket are touched.
  - Inputs whose on-chain UTXO status cannot be determined (service
    error / inconclusive) are left spendable=true. Eviction is opt-in
    based on positive evidence of stale state.
  - Inputs the chain confirms are still UTXOs (e.g. a competing tx
    itself failed, or a malformed/fee failure where inputs are intact)
    are left spendable=true — preserving the existing transient-retry
    semantics callers depend on.

Returns counts for instrumentation and the set of stale outpoints
that were actually evicted (added to history note for diagnostics).

```ts
export async function markStaleInputsAsSpent(ar: AggregatePostBeefTxResult, storage: StorageProvider, services: sdk.WalletServices, trx?: sdk.TrxToken, logger?: WalletLoggerInterface): Promise<{
    checked: number;
    staleConfirmed: number;
    staleOutpoints: string[];
}>
```

See also: [AggregatePostBeefTxResult](#interface-aggregatepostbeeftxresult), [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesCertificateFieldPartial

```ts
export function matchesCertificateFieldPartial(r: TableCertificateField, partial: Partial<TableCertificateField>): boolean
```

See also: [TableCertificateField](#interface-tablecertificatefield)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesCertificatePartial

```ts
export function matchesCertificatePartial(r: TableCertificate, partial: Partial<TableCertificate>): boolean
```

See also: [TableCertificate](#interface-tablecertificate)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesCommissionPartial

```ts
export function matchesCommissionPartial(r: TableCommission, partial: Partial<TableCommission>): boolean
```

See also: [TableCommission](#interface-tablecommission)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesMonitorEventPartial

```ts
export function matchesMonitorEventPartial(r: TableMonitorEvent, partial: Partial<TableMonitorEvent>): boolean
```

See also: [TableMonitorEvent](#interface-tablemonitorevent)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesOutputBasketPartial

```ts
export function matchesOutputBasketPartial(r: TableOutputBasket, partial: Partial<TableOutputBasket>): boolean
```

See also: [TableOutputBasket](#interface-tableoutputbasket)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesOutputPartial

```ts
export function matchesOutputPartial(r: TableOutput, partial: Partial<TableOutput>): boolean
```

See also: [TableOutput](#interface-tableoutput)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesOutputTagMapPartial

```ts
export function matchesOutputTagMapPartial(r: TableOutputTagMap, partial: Partial<TableOutputTagMap>): boolean
```

See also: [TableOutputTagMap](#interface-tableoutputtagmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesOutputTagPartial

```ts
export function matchesOutputTagPartial(r: TableOutputTag, partial: Partial<TableOutputTag>): boolean
```

See also: [TableOutputTag](#interface-tableoutputtag)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesProvenTxPartial

```ts
export function matchesProvenTxPartial(r: TableProvenTx, partial: Partial<TableProvenTx>): boolean
```

See also: [TableProvenTx](#interface-tableproventx)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesProvenTxReqPartial

```ts
export function matchesProvenTxReqPartial(r: TableProvenTxReq, partial: Partial<TableProvenTxReq>): boolean
```

See also: [TableProvenTxReq](#interface-tableproventxreq)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesSyncStatePartial

```ts
export function matchesSyncStatePartial(r: TableSyncState, partial: Partial<TableSyncState>): boolean
```

See also: [TableSyncState](#interface-tablesyncstate)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesTransactionPartial

```ts
export function matchesTransactionPartial(r: TableTransaction, partial: Partial<TableTransaction>): boolean
```

See also: [TableTransaction](#interface-tabletransaction)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesTxLabelMapPartial

```ts
export function matchesTxLabelMapPartial(r: TableTxLabelMap, partial: Partial<TableTxLabelMap>): boolean
```

See also: [TableTxLabelMap](#interface-tabletxlabelmap)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: matchesTxLabelPartial

```ts
export function matchesTxLabelPartial(r: TableTxLabel, partial: Partial<TableTxLabel>): boolean
```

See also: [TableTxLabel](#interface-tabletxlabel)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: mergeInputBeefs

For each input of `rawTx`, ensure the source txid is represented in `beef`.

When `requiredLevels` is undefined/0 and `knownTxids` contains the source txid,
a txid-only stub is merged rather than recursing into storage.

```ts
export async function mergeInputBeefs(rawTx: number[], beef: Beef, trustSelf: "known" | undefined, knownTxids: string[] | undefined, trx: TrxToken | undefined, requiredLevels: number | undefined, getValidBeef: (txid: string, beef: Beef, trustSelf: "known" | undefined, knownTxids: string[] | undefined, trx: TrxToken | undefined, requiredLevels: number | undefined) => Promise<unknown>): Promise<void>
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: mergeInputsIntoBeef

Convenience wrapper for the external-sharing path where `trustSelf` and
`requiredLevels` are always absent.

```ts
export async function mergeInputsIntoBeef(rawTx: number[], beef: Beef, knownTxids: string[], trx: TrxToken | undefined, getValidBeef: (txid: string, beef: Beef, trustSelf: undefined, knownTxids: string[], trx: TrxToken | undefined) => Promise<unknown>): Promise<void>
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: notifyTransactionsOfProof

Notify each transaction that a proof has been found.
Mutates `req` history notes in place.

The `addNote` and `flushNotes` callbacks avoid coupling this helper to a
specific entity type.

```ts
export async function notifyTransactionsOfProof(ids: number[], provenTxId: number, addNote: (note: ReqHistoryNote) => void, flushNotes: () => Promise<void>, updateTransaction: (id: number, update: {
    provenTxId: number;
    status: "completed";
}) => Promise<unknown>): Promise<void>
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: offsetPrivKey

```ts
export function offsetPrivKey(privKey: string, keyOffset?: string): {
    offsetPrivKey: string;
    keyOffset: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: offsetPubKey

```ts
export function offsetPubKey(pubKey: string, keyOffset?: string): {
    offsetPubKey: string;
    keyOffset: string;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: partitionActionLabels

```ts
export function partitionActionLabels(ordinaryLabels: string[]): {
    specOp: ListActionsSpecOp | undefined;
    specOpLabels: string[];
    labels: string[];
}
```

See also: [ListActionsSpecOp](#interface-listactionsspecop)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: processAction

```ts
export async function processAction(storage: StorageProvider, auth: AuthId, args: StorageProcessActionArgs): Promise<StorageProcessActionResults>
```

See also: [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: purgeData

```ts
export async function purgeData(storage: StorageKnex, params: PurgeParams, trx?: TrxToken): Promise<PurgeResults>
```

See also: [StorageKnex](#class-storageknex)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: purgeDataIdb

```ts
export async function purgeDataIdb(storage: StorageIdb, params: PurgeParams, trx?: TrxToken): Promise<PurgeResults>
```

See also: [StorageIdb](#class-storageidb)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: redeemServiceCharges

```ts
export function redeemServiceCharges(privateKeyWif: string, charges: TableCommission[]): Array<{}>
```

See also: [TableCommission](#interface-tablecommission)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: renderAdminPage

```ts
export function renderAdminPage(): string
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: reviewStatus

Looks for unpropagated state:

1. set transactions to 'failed' if not already failed and provenTxReq with matching txid has status of 'invalid'.
2. sets outputs to spendable true, spentBy undefined if spentBy is a transaction with status 'failed'.
3. sets transactions to 'completed' if provenTx with matching txid exists and current provenTxId is null.

```ts
export async function reviewStatus(storage: StorageKnex, args: {
    agedLimit: Date;
    trx?: TrxToken;
}): Promise<{
    log: string;
}>
```

See also: [StorageKnex](#class-storageknex)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: reviewStatusIdb

Looks for unpropagated state:

1. set transactions to 'failed' if not already failed and provenTxReq with matching txid has status of 'invalid'.
2. sets transactions to 'completed' if provenTx with matching txid exists and current provenTxId is null.
3. sets outputs to spendable true, spentBy undefined if spentBy is a transaction with status 'failed'.

```ts
export async function reviewStatusIdb(storage: StorageIdb, args: {
    agedLimit: Date;
    trx?: sdk.TrxToken;
}): Promise<{
    log: string;
}>
```

See also: [StorageIdb](#class-storageidb)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: setDisableDoubleSpendCheckForTest

```ts
export function setDisableDoubleSpendCheckForTest(v: boolean)
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: shareReqsWithWorld

```ts
export async function shareReqsWithWorld(storage: StorageProvider, userId: number, txids: string[], isDelayed: boolean, r?: GetReqsAndBeefResult, logger?: WalletLoggerInterface): Promise<{
    swr: SendWithResult[];
    ndr: ReviewActionResult[] | undefined;
}>
```

See also: [GetReqsAndBeefResult](#interface-getreqsandbeefresult), [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: summarizePostBeefProviderAttemptsForTxid

```ts
export function summarizePostBeefProviderAttemptsForTxid(txid: string, pbrs: sdk.PostBeefResult[]): string[]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: transactionInputSize

```ts
export function transactionInputSize(scriptSize: number): number
```

Returns

serialized byte length a transaction input

Argument Details

+ **scriptSize**
  + byte length of input script

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: transactionOutputSize

```ts
export function transactionOutputSize(scriptSize: number): number
```

Returns

serialized byte length a transaction output

Argument Details

+ **scriptSize**
  + byte length of output script

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: transactionSize

Compute the serialized binary transaction size in bytes
given the number of inputs and outputs,
and the size of each script.

```ts
export function transactionSize(inputs: number[], outputs: number[]): number
```

Returns

total transaction size in bytes

Argument Details

+ **inputs**
  + array of input script lengths, in bytes
+ **outputs**
  + array of output script lengths, in bytes

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: updateReqsFromAggregateResults

For each txid in submitted `txids`:

  Based on its aggregate status, and whether broadcast happening in background (isDelayed) or immediately (!isDelayed),
  and iff current req.status is not 'unproven' or 'completed':

    'success':
      req.status => 'unmined', tx.status => 'unproven'
    'doubleSpend':
      req.status => 'doubleSpend', tx.status => 'failed'
    'invalidTx':
      req.status => 'invalid', tx.status => 'failed'
    'serviceError':
      increment req.attempts

```ts
export async function updateReqsFromAggregateResults(txids: string[], r: PostReqsToNetworkResult, apbrs: Record<string, AggregatePostBeefTxResult>, storage: StorageProvider, services?: sdk.WalletServices, trx?: sdk.TrxToken, logger?: WalletLoggerInterface): Promise<void>
```

See also: [AggregatePostBeefTxResult](#interface-aggregatepostbeeftxresult), [PostReqsToNetworkResult](#interface-postreqstonetworkresult), [StorageProvider](#class-storageprovider)

Argument Details

+ **services**
  + if valid, doubleSpend results will be verified (but only if not within a trx. e.g. trx must be undefined)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeAllStoresV1

Upgrade handler for every store that existed at schema version 1.

```ts
export function upgradeAllStoresV1(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeCertificateFields

```ts
export function upgradeCertificateFields(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeCertificates

```ts
export function upgradeCertificates(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeCommissions

```ts
export function upgradeCommissions(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeMonitorEvents

```ts
export function upgradeMonitorEvents(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeOutputBaskets

```ts
export function upgradeOutputBaskets(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeOutputTags

```ts
export function upgradeOutputTags(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeOutputTagsMap

```ts
export function upgradeOutputTagsMap(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeOutputs

```ts
export function upgradeOutputs(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeProvenTxReqs

```ts
export function upgradeProvenTxReqs(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeProvenTxs

```ts
export function upgradeProvenTxs(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeSyncStates

```ts
export function upgradeSyncStates(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeTransactions

```ts
export function upgradeTransactions(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeTxLabels

```ts
export function upgradeTxLabels(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeTxLabelsMap

```ts
export function upgradeTxLabelsMap(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: upgradeUsers

```ts
export function upgradeUsers(db: IDBPDatabase<StorageIdbSchema>): void
```

See also: [StorageIdbSchema](#interface-storageidbschema)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateDate

Shared entity-validation helpers used by both client-side storage remoting
(StorageClientBase / StorageMobile) and the server-side StorageServer.

These helpers normalise records returned from remote calls or database queries:
  - Coerce date strings / timestamps to `Date` objects.
  - Replace `null` values with `undefined`.
  - Replace `Uint8Array` / `Buffer` values with plain `number[]` arrays.

```ts
export function validateDate(date: Date | string | number): Date
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateEntities

Force uniform behaviour across database engines.
Use to process all arrays of records with timestamps retrieved from database.

```ts
export function validateEntities<T extends EntityTimeStamp>(entities: T[], dateFields?: string[]): T[]
```

Returns

input `entities` array with contained values validated.

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateEntity

Force uniform behaviour across database engines.
Use to process all individual records with timestamps retrieved from database.

```ts
export function validateEntity<T extends EntityTimeStamp>(entity: T, dateFields?: string[]): T
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateGenerateChangeSdkParams

```ts
export function validateGenerateChangeSdkParams(params: GenerateChangeSdkParams): ValidateGenerateChangeSdkParamsResult
```

See also: [GenerateChangeSdkParams](#interface-generatechangesdkparams), [ValidateGenerateChangeSdkParamsResult](#interface-validategeneratechangesdkparamsresult)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateGenerateChangeSdkResult

```ts
export function validateGenerateChangeSdkResult(params: GenerateChangeSdkParams, r: GenerateChangeSdkResult): {
    ok: boolean;
    log: string;
}
```

See also: [GenerateChangeSdkParams](#interface-generatechangesdkparams), [GenerateChangeSdkResult](#interface-generatechangesdkresult)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateStorageFeeModel

```ts
export function validateStorageFeeModel(v?: StorageFeeModel): StorageFeeModel
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: validateSyncChunkEntities

Validate all entity arrays within a `SyncChunk` received from a remote storage call.
Normalises timestamps, nulls, and binary fields in-place.

```ts
export function validateSyncChunkEntities(r: SyncChunk): SyncChunk
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Function: varUintSize

Returns the byte size required to encode number as Bitcoin VarUint

```ts
export function varUintSize(val: number): 1 | 3 | 5 | 9 {
    if (val < 0)
        throw new WERR_INVALID_PARAMETER("varUint", "non-negative");
    if (val <= 252)
        return 1;
    if (val <= 65535)
        return 3;
    if (val <= 4294967295)
        return 5;
    return 9;
}
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
#### Types

| |
| --- |
| [DBType](#type-dbtype) |
| [EntityStorage](#type-entitystorage) |
| [PostReqsToNetworkDetailsStatus](#type-postreqstonetworkdetailsstatus) |

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

##### Type: DBType

```ts
export type DBType = "MySQL" | "IndexedDB"
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Type: EntityStorage

```ts
export type EntityStorage = StorageProvider
```

See also: [StorageProvider](#class-storageprovider)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Type: PostReqsToNetworkDetailsStatus

Indicates status of a new Action following a `createAction` or `signAction` in immediate mode:
When `acceptDelayedBroadcast` is falses.

'success': The action has been broadcast and accepted by the bitcoin processing network.
'doubleSpend': The action has been confirmed to double spend one or more inputs, and by the "first-seen-rule" is the losing transaction.
'invalidTx': The action was rejected by the processing network as an invalid bitcoin transaction.
'serviceError': The broadcast services are currently unable to reach the bitcoin network. The action is now queued for delayed retries.

'invalid': The action was in an invalid state for processing, this status should never be seen by user code.
'unknown': An internal processing error has occured, this status should never be seen by user code.

```ts
export type PostReqsToNetworkDetailsStatus = "success" | "doubleSpend" | "unknown" | "invalid" | "serviceError" | "invalidTx"
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
#### Variables

| |
| --- |
| [getLabelToSpecOp](#variable-getlabeltospecop) |
| [maxChangeOutputsPerTransaction](#variable-maxchangeoutputspertransaction) |
| [maxPossibleSatoshis](#variable-maxpossiblesatoshis) |
| [outputColumnsWithoutLockingScript](#variable-outputcolumnswithoutlockingscript) |
| [transactionColumnsWithoutRawTx](#variable-transactioncolumnswithoutrawtx) |

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

##### Variable: getLabelToSpecOp

```ts
getLabelToSpecOp: () => Record<string, ListActionsSpecOp> = () => {
    return {
        [specOpNoSendActions]: {
            name: "noSendActions",
            labelsToIntercept: ["abort"],
            setStatusFilter: () => ["nosend"],
            postProcess: async (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListActionsArgs, specOpLabels: string[], txs: Array<Partial<TableTransaction>>): Promise<void> => {
                if (specOpLabels.includes("abort")) {
                    for (const tx of txs) {
                        if (tx.status === "nosend") {
                            await s.abortAction(auth, { reference: tx.reference! });
                            tx.status = "failed";
                        }
                    }
                }
            }
        },
        [specOpFailedActions]: {
            name: "failedActions",
            labelsToIntercept: ["unfail"],
            setStatusFilter: () => ["failed"],
            postProcess: async (s: StorageProvider, auth: AuthId, vargs: Validation.ValidListActionsArgs, specOpLabels: string[], txs: Array<Partial<TableTransaction>>): Promise<void> => {
                if (specOpLabels.includes("unfail")) {
                    for (const tx of txs) {
                        if (tx.status === "failed") {
                            await s.updateTransaction(tx.transactionId!, { status: "unfail" });
                        }
                    }
                }
            }
        }
    };
}
```

See also: [ListActionsSpecOp](#interface-listactionsspecop), [StorageProvider](#class-storageprovider), [TableTransaction](#interface-tabletransaction)

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Variable: maxChangeOutputsPerTransaction

```ts
maxChangeOutputsPerTransaction = 8
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Variable: maxPossibleSatoshis

```ts
maxPossibleSatoshis = 2099999999999999
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Variable: outputColumnsWithoutLockingScript

```ts
outputColumnsWithoutLockingScript = [
    "created_at",
    "updated_at",
    "outputId",
    "userId",
    "transactionId",
    "basketId",
    "spendable",
    "change",
    "vout",
    "satoshis",
    "providedBy",
    "purpose",
    "type",
    "outputDescription",
    "txid",
    "senderIdentityKey",
    "derivationPrefix",
    "derivationSuffix",
    "customInstructions",
    "spentBy",
    "sequenceNumber",
    "spendingDescription",
    "scriptLength",
    "scriptOffset",
    "scriptHash",
    "cacheUpdatedAt"
]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---
##### Variable: transactionColumnsWithoutRawTx

```ts
transactionColumnsWithoutRawTx = [
    "created_at",
    "updated_at",
    "transactionId",
    "userId",
    "provenTxId",
    "status",
    "reference",
    "isOutgoing",
    "satoshis",
    "version",
    "lockTime",
    "description",
    "txid"
]
```

Links: [API](#api), [Interfaces](#interfaces), [Classes](#classes), [Functions](#functions), [Types](#types), [Variables](#variables)

---

<!--#endregion ts2md-api-merged-here-->
