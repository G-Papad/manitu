import { logger } from "./logger"
import { Transaction } from "./transcation"
import { validationError } from "./types"

export type UTXO = Set<string>

export class UTXOSet {
    outpoints: UTXO = new Set<string>()

    constructor(outpoints: UTXO) {
        this.outpoints = outpoints
    }

    copy() {
        return new UTXOSet(new Set<string>(Array.from(this.outpoints)))
    }

    async applyTransaction(tx : Transaction){
        logger.debug(`Applying transaction ${tx.txid} to UTXO set`)
        const seen = new Set<string>()

        for (const input of tx.inputs){
            const outpointId = `<outpoint: (${input.outpoint.txid}, ${input.outpoint.index})>`
            if(!this.outpoints.has(outpointId)){
                logger.debug(`\x1b[33mTransaction ${tx.txid} consumes ${outpointId} which is not in the UTXO set: ${this.toString()}.\x1b[0m`)
                throw new validationError(`INVALID_TX_OUTPOINT`, `Transaction ${tx.txid} consumes ${outpointId} which is not in the UTXO set.`)
            }
            if(seen.has(outpointId)){
                logger.debug(`Transaction's ${tx.txid} inputs spend the same outpoint`)
                throw new validationError(`INVALID_TX_OUTPOINT`, `Transaction's ${tx.txid} inputs spend the same outpoint`)
            }
            seen.add(outpointId)
        }
        logger.debug(`Valid Transaction ${tx.txid} with respect to state`)
        logger.debug(`Applying tx ${tx.txid} to state`)
        for (const input of tx.inputs){
            const outpointId = `<outpoint: (${input.outpoint.txid}, ${input.outpoint.index})>`
            this.outpoints.delete(outpointId)
        }

        for (let i=0; i < tx.outputs.length; i++){
            const outpointId = `<outpoint: (${tx.txid}, ${i})>`
            this.outpoints.add(outpointId)
        } 

        logger.debug(`New state after tx ${tx.txid}: ${this.toString()}`)
    }

    toString() {
        return `\x1b[35mUTXO set: ${JSON.stringify(Array.from(this.outpoints))}\x1b[0m`
    }
}