import { Block } from "./block";
import { Chain } from "./chain";
import { logger } from "./logger";
import { db, objectManager } from "./object";
import { Transaction } from "./transcation";
import { validationError } from "./types";
import { UTXOSet } from "./utxo";

class Mempool {
    txs: Transaction[] = []
    txIds : Set<string> | undefined
    state: UTXOSet | undefined

    async init(){
        await this.load()
        logger.debug(`\x1b[36mMempool successfully initialized\x1b[0m`)
    }

    async onTransaction(tx : Transaction){
        if(this.txIds?.has(tx.txid) || tx.isCoinbase()){
            if(tx.isCoinbase()) logger.debug(`\x1b[36mCoinbase are not added to mempool\x1b[0m`)
            else logger.debug(`\x1b[36mTx ${tx.txid} already in mempool\x1b[0m`)
            return
        }
        await this.state?.applyTransaction(tx)
        logger.debug(`\x1b[36mTx ${tx.txid} added to mempool\x1b[0m`)
        logger.debug(`\x1b[36mNew mempool state: ${this.state?.toString()}\x1b[0m`)
        this.txs.push(tx)
        this.txIds?.add(tx.txid)
        this.save()
        logger.debug(`\x1b[36Mempool txids: [${[...this.txIds!]}]\x1b[0m`)
    }

    async onBlockExtendingLongestChain(block: Block){
        logger.debug(`\x1b[36mChange mempool due to Block ${block.blockid}\x1b[0m`)
        const oldTxs : Transaction[] = this.txs.slice()
        let remained: number = 0
        
        this.state = block.stateAfter
        this.txs = []
        this.txIds = new Set<string>()

        for(const tx of oldTxs){
            try{
                await this.onTransaction(tx)
                remained++;
            }
            catch{}
        }
        await this.save()
        logger.info(`\x1b[36Mempool state after Block ${block.blockid} is ${this.state?.toString()}\x1b[0m`)
        logger.info(`\x1b[36mRemaining txs in mempool after block ${block.blockid}: [${[...this.txIds]}]\x1b[0m`)
    }

    async reorg(prevChain: Chain, newChain: Chain){
        logger.debug(`\x1b[36mReorg mempool\x1b[0m`)
        const oldTxs : Transaction[] = this.txs
        let potentialTxs: Transaction[] = []

        for(const block of prevChain.blocks){
            const prevTrans = await block.getTxs()
            potentialTxs = [...potentialTxs, ...prevTrans]
        }
        logger.debug(`\x1b[36mThere are ${potentialTxs.length} transactions from previous Chain: ${potentialTxs}\x1b[0m`)
        potentialTxs = [...potentialTxs, ...oldTxs]

        this.txs = []
        this.txIds = new Set<string>()

        const tip = newChain.blocks[newChain.blocks.length-1]
        if(tip?.stateAfter === undefined){ 
            throw new Error(`Tip ${tip?.blockid} has not been calculated`)
        }
        this.state = tip.stateAfter

        let remained : number = 0;
        for(const tx of potentialTxs){
            try{
                await this.onTransaction(tx)
                remained++;
            }
            catch{}
        }
        await this.save()
        logger.info(`\x1b[36mRemaining txs in mempool after reorg: ${this.txIds}\x1b[0m`)
    }

    async getTx(){
        if(!this.txIds) throw new validationError(`INTERNAL_ERROR`,`Mempool is not initialized. getTx cannot find txIds`)
        this.txs = []
        for(const txid of this.txIds){
            this.txs.push(Transaction.fromNetworkObject(await objectManager.get(txid)))
        }
    }

    async load(){
        try{
            this.txIds = await db.get(`mem:txids`)
            await this.getTx()
            logger.debug(`\x1b[36mMempool transactions loaded from db: ${this.txs}\x1b[0m`)

            const memState = await db.get(`mem:state`)
            this.state = new UTXOSet(new Set<string>(memState))
            logger.debug(`\x1b[36mMempool state loaded from db: ${this.state.toString()}\x1b[0m`)
        }
        catch(e){
            logger.debug(`\x1b[36mMempool load error: ${e}. Initialize empty mempool\x1b[0m`)
            this.txs = []
            this.txIds = new Set<string>()
            this.state = new UTXOSet(new Set<string>())
            await this.save()
        }
    }

    async save(){
        if(this.txIds === undefined || this.state === undefined)
            throw new validationError(`INTERNAL_ERROR`, `Mempool is not initialized, error while saving.`)
        await db.put(`mem:txids`, this.txIds)
        await db.put(`mem:state`, Array.from(this.state.outpoints))
    }
}


export const mempool = new Mempool()