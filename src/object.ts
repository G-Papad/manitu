import level from 'level-ts'
import { canonicalize } from 'json-canonicalize'
import { ApplicationObject, BlockType, isBlock, isCoinbaseTransaction, isTransaction } from './types'
import { hash } from './crypto'
import { validationError } from './types';
import { logger } from './logger';
import { Transaction } from './transcation';
import { Block } from './block';

import { createGetObjectMessage } from './message';
import { OBJECT_FETCH_TIMEOUT } from './HardCodedData';
import { mempool } from './mempool';
import { network } from './network';
import { Peer } from './peer';

export const db = new level('./db');

type Waiter = {
  resolve: (v: ApplicationObject) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

class ObjectManager {
    requested = new Set<string>();
    pending = new Map<string, Waiter[]>();

    id(obj: ApplicationObject){
        return hash(canonicalize(obj));
    }
    async exists(objId : string){
        return await db.exists(`object:${objId}`);
    }
    async get(objId : string){
        try{
            return await db.get(`object:${objId}`);
        } catch {
            throw new validationError('UNKNOWN_OBJECT', `Object ${objId} not stored in db`);
        }
    }
    async put(object: ApplicationObject){
        const objId = this.id(object);
        logger.debug(`Storing object ${objId}`);
        return await db.put(`object:${objId}`, object);
    }

    async validate(object: any, peer?: Peer) : Promise<Transaction | Block>{
        const objId = this.id(object);
        if(isTransaction(object) || isCoinbaseTransaction(object)){
            const tx: Transaction = Transaction.fromNetworkObject(object);
            logger.debug(`Validating tx: ${tx.txid}`);
            await tx.validate();
            if(this.requested.has(tx.txid)){
                return tx
            }
            try{
                await mempool.onTransaction(tx)
            }
            catch(e){
                logger.error(`\x1b[31mTx ${objId} is invalid to mempool state. Error: ${e}, desc: ${(e as validationError).description}\x1b[0m`)
                logger.debug(`\x1b[31mmempool state is: ${[...mempool.txIds!]}\x1b[0m`)
                throw new validationError(`INVALID_TX_OUTPOINT`, `Tx ${objId} is invalid to mempool state`)
            }
            return tx;
        }
        else {
            logger.debug(`Check if ${object} is block`)
            if(isBlock(object)){
                logger.debug(`Validating object: ${object}`)
                const b = await Block.fromNetworkObject(object as BlockType);
                logger.debug(`Validating block: ${b.blockid}`);
                await b.validate(peer);
                return b;
            }
        }
        throw new validationError('UNKNOWN_OBJECT', `Object ${objId} is not a valid object`);
    }

    async fetch(objId : string, peer?: Peer) : Promise<ApplicationObject>{
        logger.debug(`Fetching object ${objId}`);
        let obj : ApplicationObject
        
        try {
            obj = await this.get(objId);
            logger.debug(`Object ${objId} found locally`);
            return obj;
        }
        catch(e){
            // TODO: assert this is the new validationError('UNKNOWN_OBJECT', `Object ${objId} not stored in db`);
        }

        // logger.debug(`Requesting object ${objId} from peer ${peer?.addr}`)
        if (!this.requested.has(objId)) {
            this.requested.add(objId);
            if(peer === undefined){
                network.broadcast(createGetObjectMessage(objId));
            } 
            else{
                logger.debug(`Asking ${objId} from peer ${peer.addr}`)
                peer.send(createGetObjectMessage(objId));
            }
        }

        obj = await new Promise<ApplicationObject>(async (resolve, reject) => {
            const waiter: Waiter = {
                resolve,
                reject,
                timer: setTimeout(() => {
                    const arr = this.pending.get(objId) ?? [];
                    const next = arr.filter((w) => w !== waiter);
                    if (next.length === 0) this.pending.delete(objId);
                    else this.pending.set(objId, next);
                    logger.debug(`Timeout of fetching object ${objId} exceeded`)
                    reject(new validationError("UNFINDABLE_OBJECT", `Timeout of fetching object ${objId} exceeded`));
                }, OBJECT_FETCH_TIMEOUT),
            };    

            const arr = this.pending.get(objId) ?? [];
            arr.push(waiter);
            this.pending.set(objId, arr);
        })

        logger.debug(`Object ${objId} was send by peer ${peer?.addr}`);
        return obj;
    }


    notifyObjectStored(objId: string, value: ApplicationObject) {
      const ws = this.pending.get(objId);
      if (!ws) return;
      this.pending.delete(objId);
      for (const w of ws) {
        clearTimeout(w.timer);
        w.resolve(value);
      }
    }
    notifyObjectFailed(objId: string, err: Error) {
      const ws = this.pending.get(objId);
      if (!ws) return;
      this.pending.delete(objId);
      for (const w of ws) {
        clearTimeout(w.timer);
        w.reject(err);
      }
    }
}

export const objectManager = new ObjectManager()



