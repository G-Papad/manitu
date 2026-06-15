import mongoose from 'mongoose';
import { logger } from './logger';
import { Block } from './block';
import { Transaction } from './transcation';
import { objectManager } from './object';
import { isBlock } from './types';
import { chainManager } from './chain';

const OUTPOINT_RE = /<outpoint: \(([0-9a-f]+), (\d+)\)>/;

// Configure both URIs — leave empty to skip that DB
const LOCAL_MONGODB_URI = process.env.LOCAL_MONGODB_URI ?? '';
const ATLAS_MONGODB_URI = process.env.ATLAS_MONGODB_URI ?? '';

// Separate mongoose connections for each DB
const localConn = mongoose.createConnection();
const atlasConn = mongoose.createConnection();

let localDbPromise: Promise<mongoose.mongo.Db | null> | null = null;
let atlasDbPromise: Promise<mongoose.mongo.Db | null> | null = null;

async function getLocalDb(): Promise<mongoose.mongo.Db | null> {
  if (!LOCAL_MONGODB_URI) return null;
  if (!localDbPromise) {
    localDbPromise = localConn
      .openUri(LOCAL_MONGODB_URI, { bufferCommands: false })
      .then((conn): mongoose.mongo.Db | null => {
        logger.info('siteSync: connected to local MongoDB');
        return conn.db ?? null;
      })
      .catch((e): null => {
        logger.warn(`siteSync: local MongoDB connection failed: ${e.message}`);
        localDbPromise = null;
        return null;
      });
  }
  return localDbPromise;
}

async function getAtlasDb(): Promise<mongoose.mongo.Db | null> {
  if (!ATLAS_MONGODB_URI) return null;
  if (!atlasDbPromise) {
    atlasDbPromise = atlasConn
      .openUri(ATLAS_MONGODB_URI, { bufferCommands: false })
      .then((conn): mongoose.mongo.Db | null => {
        logger.info('siteSync: connected to Atlas MongoDB');
        return conn.db ?? null;
      })
      .catch((e): null => {
        logger.warn(`siteSync: Atlas MongoDB connection failed: ${e.message}`);
        atlasDbPromise = null;
        return null;
      });
  }
  return atlasDbPromise;
}

async function getDbs(): Promise<mongoose.mongo.Db[]> {
  const [local, atlas] = await Promise.all([getLocalDb(), getAtlasDb()]);
  return [local, atlas].filter((db): db is mongoose.mongo.Db => db !== null);
}

// ---- Sync helpers ----------------------------------------------------------

async function upsertToAll(
  dbs: mongoose.mongo.Db[],
  collection: string,
  filter: object,
  data: object
): Promise<void> {
  await Promise.all(
    dbs.map((db) =>
      db.collection(collection)
        .updateOne(filter, { $setOnInsert: data }, { upsert: true })
        .catch((e: any) => logger.warn(`siteSync: ${collection} upsert failed: ${e.message}`))
    )
  );
}

// ---- Public API ------------------------------------------------------------

export async function syncAccounts(tipBlock: Block): Promise<void> {
  const dbs = await getDbs();
  if (dbs.length === 0) return;

  if (!tipBlock.stateAfter) {
    logger.warn('siteSync: syncAccounts called with block that has no stateAfter');
    return;
  }

  logger.info(`siteSync: recomputing accounts from tip ${tipBlock.blockid.slice(0, 12)}...`);

  const accounts = new Map<string, { balance: number; txids: Set<string> }>();

  for (const outpointStr of tipBlock.stateAfter.outpoints) {
    const match = outpointStr.match(OUTPOINT_RE);
    if (!match) {
      logger.warn(`siteSync: could not parse outpoint: ${outpointStr}`);
      continue;
    }
    const txid = match[1]!;
    const index = parseInt(match[2]!, 10);

    let rawTx: any;
    try {
      rawTx = await objectManager.get(txid);
    } catch {
      logger.warn(`siteSync: tx ${txid.slice(0, 12)}... not found for account computation`);
      continue;
    }

    const outputs = rawTx.outputs;
    if (!Array.isArray(outputs) || index >= outputs.length) {
      logger.warn(`siteSync: tx ${txid.slice(0, 12)}... output index ${index} out of range`);
      continue;
    }

    const { pubkey, value } = outputs[index] as { pubkey: string; value: number };
    const entry = accounts.get(pubkey);
    if (entry) {
      entry.balance += value;
      entry.txids.add(txid);
    } else {
      accounts.set(pubkey, { balance: value, txids: new Set([txid]) });
    }
  }

  const docs = Array.from(accounts.entries()).map(([id, { balance, txids }]) => ({
    id,
    balance,
    transactionIds: Array.from(txids),
  }));

  await Promise.all(
    dbs.map(async (db) => {
      try {
        await db.collection('accounts').deleteMany({});
        if (docs.length > 0) await db.collection('accounts').insertMany(docs);
        logger.info(`siteSync: accounts synced — ${accounts.size} account(s)`);
      } catch (e: any) {
        logger.warn(`siteSync: accounts sync failed: ${e.message}`);
      }
    })
  );
}

export async function syncObject(
  rawObject: any,
  objectId: string,
  instance: Block | Transaction
): Promise<void> {
  const dbs = await getDbs();
  if (dbs.length === 0) return;

  if (instance instanceof Block) {
    if (instance.height === undefined) return;

    const data = { ...rawObject, id: objectId, height: instance.height };
    await upsertToAll(dbs, 'blocks', { id: objectId }, data);
//    logger.info(`siteSync: block height=${instance.height} ${objectId.slice(0, 12)}... synced`);

    if (instance.blockid === chainManager.tip?.blockid) {
      await syncAccounts(instance).catch((e) =>
        logger.warn(`siteSync: accounts update failed: ${e.message}`)
      );
    }
  } else {
    const data = { ...rawObject, id: objectId };
    await upsertToAll(dbs, 'transactions', { id: objectId }, data);
 //   logger.debug(`siteSync: tx ${objectId.slice(0, 12)}... synced`);
  }
}

export async function syncAllFromLevelDB(tipBlock: Block): Promise<void> {
  const dbs = await getDbs();
  if (dbs.length === 0) return;

  logger.info('siteSync: starting startup sync from LevelDB...');
  let currentId: string | null = tipBlock.blockid;
  let loadedTip: Block | null = null;

  while (currentId !== null) {
    let rawBlock: any;
    try {
      rawBlock = await objectManager.get(currentId);
    } catch {
      break;
    }

    if (!isBlock(rawBlock)) break;

    const block = await Block.fromNetworkObject(rawBlock);
    try {
      await block.load();
    } catch {
      break;
    }

    if (loadedTip === null) loadedTip = block;

    for (const txid of block.txids) {
      let rawTx: any;
      try {
        rawTx = await objectManager.get(txid);
      } catch {
        continue;
      }
      await upsertToAll(dbs, 'transactions', { id: txid }, { ...rawTx, id: txid });
   //   logger.debug(`siteSync: startup tx ${txid.slice(0, 12)}... synced`);
    }

    const blockData = { ...rawBlock, id: currentId, height: block.height };
    await upsertToAll(dbs, 'blocks', { id: currentId }, blockData);
   // logger.info(`siteSync: startup block height=${block.height} ${currentId.slice(0, 12)}... synced`);

    currentId = block.previd;
  }

  logger.info('siteSync: startup sync complete');

  if (loadedTip) {
    await syncAccounts(loadedTip).catch((e) =>
      logger.warn(`siteSync: startup accounts sync failed: ${e.message}`)
    );
  }
}
