import express from 'express';
import { NextFunction, Request, Response } from 'express';

import { chainManager } from './chain';
import { logger } from './logger';
import { db, objectManager } from './object';
import { isBlock, isCoinbaseTransaction, isTransaction } from './types';

const API_PORT = parseInt(process.env.API_PORT ?? '3001');
const API_SECRET = process.env.API_SECRET ?? '';

const OUTPOINT_RE = /<outpoint: \(([0-9a-f]+), (\d+)\)>/;

const heightIndex = new Map<number, string[]>();
const previdIndex = new Map<string, string[]>();
const blockCache = new Map<string, BlockDoc>();

interface BlockDoc {
  id: string;
  height: number;
  type: 'block';
  created: number;
  T: string;
  nonce: string;
  previd: string | null;
  miner?: string;
  note?: string;
  studentids?: string[];
  txids: string[];
}

function makeBlockDoc(raw: any, id: string, height: number): BlockDoc {
  return {
    id,
    height,
    type: 'block',
    created: raw.created,
    T: raw.T,
    nonce: raw.nonce,
    previd: raw.previd ?? null,
    ...(raw.miner !== undefined && { miner: raw.miner }),
    ...(raw.note !== undefined && { note: raw.note }),
    ...(raw.studentids !== undefined && { studentids: raw.studentids }),
    txids: raw.txids,
  };
}

export async function buildIndexes(): Promise<void> {
  heightIndex.clear();
  previdIndex.clear();
  blockCache.clear();

  const tip = chainManager.tip;
  if (!tip) {
    logger.info('api: no tip, indexes empty');
    return;
  }

  let currentId: string | null = tip.blockid;

  while (currentId !== null) {
    let raw: any;
    try {
      raw = await objectManager.get(currentId);
    } catch {
      break;
    }

    if (!isBlock(raw)) break;

    let meta: { height: number };
    try {
      meta = await db.get(`blockmeta:${currentId}`);
    } catch {
      break;
    }

    const doc = makeBlockDoc(raw, currentId, meta.height);

    if (!heightIndex.has(meta.height)) heightIndex.set(meta.height, []);
    (heightIndex.get(meta.height) as string[]).push(currentId);

    if (raw.previd !== null) {
      if (!previdIndex.has(raw.previd)) previdIndex.set(raw.previd, []);
      (previdIndex.get(raw.previd) as string[]).push(currentId);
    }

    blockCache.set(currentId, doc);
    currentId = raw.previd ?? null;
  }

  logger.info(`api: indexes built — ${blockCache.size} block(s) indexed`);
}

export function indexBlock(raw: any, id: string, height: number): void {
  const doc = makeBlockDoc(raw, id, height);

  if (!heightIndex.has(height)) heightIndex.set(height, []);
  if (!(heightIndex.get(height) as string[]).includes(id)) {
    (heightIndex.get(height) as string[]).push(id);
  }

  if (raw.previd !== null) {
    if (!previdIndex.has(raw.previd)) previdIndex.set(raw.previd, []);
    if (!(previdIndex.get(raw.previd) as string[]).includes(id)) {
      (previdIndex.get(raw.previd) as string[]).push(id);
    }
  }

  blockCache.set(id, doc);
}

async function getAccount(
  address: string
): Promise<{ id: string; balance: number; transactionIds: string[] } | null> {
  const tip = chainManager.tip;
  if (!tip) return null;

  // Load stateAfterOutpoints from blockmeta since tip.stateAfter
  // may not be properly restored after process restart
  let outpoints: string[];
  try {
    const meta: { height: number; stateAfterOutpoints: string[] } =
      await db.get(`blockmeta:${tip.blockid}`);
    outpoints = meta.stateAfterOutpoints;
  } catch {
    return null;
  }

  let balance = 0;
  const txids = new Set<string>();

  for (const outpointStr of outpoints) {
    const match = outpointStr.match(OUTPOINT_RE);
    if (!match) continue;

    const txid = match[1] as string;
    const index = parseInt(match[2] as string, 10);

    let raw: any;
    try {
      raw = await objectManager.get(txid);
    } catch {
      continue;
    }

    const output = raw.outputs?.[index];
    if (!output || output.pubkey !== address) continue;

    balance += output.value;
    txids.add(txid);
  }

  if (balance === 0 && txids.size === 0) return null;
  return { id: address, balance, transactionIds: Array.from(txids) };
}


export function startApi(): void {
  const app = express();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!API_SECRET) return next();
    if (req.headers['authorization'] !== `Bearer ${API_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.get('/chain/tip', async (req: Request, res: Response) => {
    const tip = chainManager.tip;
    if (!tip) { res.status(404).json({ error: 'No tip' }); return; }

    const cached = blockCache.get(tip.blockid);
    if (cached) { res.json(cached); return; }

    let raw: any;
    try {
      raw = await objectManager.get(tip.blockid);
    } catch {
      res.status(404).json({ error: 'Tip block not found in LevelDB' }); return;
    }

    res.json(makeBlockDoc(raw, tip.blockid, tip.height ?? 0));
  });

  app.get('/chain', async (req: Request, res: Response) => {
    const from = req.query.from as string;
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50') || 50, 100);

    if (!from) { res.status(400).json({ error: 'Missing from' }); return; }

    const tree: Record<number, BlockDoc[]> = {};
    let currentId: string | null = from;
    let count = 0;

    while (currentId !== null && count < limit) {
      const cached = blockCache.get(currentId);
      if (cached) {
        if (!tree[cached.height]) tree[cached.height] = [];
        (tree[cached.height] as BlockDoc[]).push(cached);
        count++;
        currentId = cached.previd;
        continue;
      }

      let raw: any;
      try {
        raw = await objectManager.get(currentId);
      } catch {
        break;
      }

      let meta: { height: number };
      try {
        meta = await db.get(`blockmeta:${currentId}`);
      } catch {
        break;
      }

      const doc = makeBlockDoc(raw, currentId, meta.height);
      if (!tree[meta.height]) tree[meta.height] = [];
      (tree[meta.height] as BlockDoc[]).push(doc);
      count++;
      currentId = raw.previd ?? null;
    }

    const isEmpty = Object.keys(tree).length === 0;
    res.json({ tree, isEmpty });
  });

  app.get('/block/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    const cached = blockCache.get(id as string);
    if (cached) { res.json(cached); return; }

    let raw: any;
    try {
      raw = await objectManager.get(id as string);
    } catch {
      res.status(404).json({ error: 'Not found' }); return;
    }

    if (!isBlock(raw)) { res.status(404).json({ error: 'Not a block' }); return; }

    let meta: { height: number };
    try {
      meta = await db.get(`blockmeta:${id}`);
    } catch {
      res.status(404).json({ error: 'Block metadata not found' }); return;
    }

    res.json(makeBlockDoc(raw, id as string, meta.height));
  });

  app.get('/block/:id/children', (req: Request, res: Response) => {
    const { id } = req.params;
    const childIds = previdIndex.get(id as string) ?? [];
    const children = childIds.map((cid) => blockCache.get(cid)).filter(Boolean);
    res.json(children);
  });

  app.get('/tree', (req: Request, res: Response) => {
    const minHeight = parseInt(req.query.minHeight as string);
    const maxHeight = parseInt(req.query.maxHeight as string);

    if (isNaN(minHeight) || isNaN(maxHeight)) {
      res.status(400).json({ error: 'minHeight and maxHeight are required' }); return;
    }

    const tree: Record<number, BlockDoc[]> = {};
    for (const [height, ids] of heightIndex.entries()) {
      if (height >= minHeight && height < maxHeight) {
        tree[height] = ids.map((id) => blockCache.get(id)).filter(Boolean) as BlockDoc[];
      }
    }

    const isEmpty = Object.keys(tree).length === 0;
    res.json({ tree, isEmpty });
  });

  app.get('/tx/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    let raw: any;
    try {
      raw = await objectManager.get(id as string);
    } catch {
      res.status(404).json({ error: 'Not found' }); return;
    }

    if (!isTransaction(raw) && !isCoinbaseTransaction(raw)) {
      res.status(404).json({ error: 'Not a transaction' }); return;
    }

    res.json({ ...raw, id });
  });

  app.get('/account/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const account = await getAccount(id as string);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json(account);
  });

  app.listen(API_PORT, () => {
    logger.info(`api: listening on port ${API_PORT}`);
  });
}
