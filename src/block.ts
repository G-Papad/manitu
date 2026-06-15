import { logger } from "./logger";
import { objectManager } from "./object";
import { Transaction } from "./transcation";
import { ApplicationObject, isBlock, isCoinbaseTransaction, isTransaction, validationError, BlockType } from "./types";
import { UTXOSet } from "./utxo"
import { BLOCK_REWARD, genesisBlock, genesisID, TARGET } from "./HardCodedData";
import { chainManager } from "./chain";
import { db } from "./object"


export class Block {
    previd: string | null
    txids: string[]
    nonce: string
    T: string
    created: number
    miner: string | undefined
    note: string | undefined
    studentids: string[] | undefined
    blockid: string
    fees: number | undefined
    stateAfter: UTXOSet | undefined
    height: number | undefined
    valid: boolean = false

    public static async makeGenesis(): Promise<Block> {
        const genesis = await Block.fromNetworkObject(genesisBlock)
        genesis.valid = true
        genesis.stateAfter = new UTXOSet(new Set<string>())
        genesis.height = 0
        await genesis.save()

        if (!await objectManager.exists(genesis.blockid)) {
        await objectManager.put(genesis.toNetworkObject())
        }

        return genesis
    }

    public static async fromNetworkObject(object : BlockType) : Promise<Block> {
        const b = new Block(
            object.previd,
            object.txids,
            object.nonce,
            object.T,
            object.created,
            object.miner,
            object.note,
            object.studentids
        )
        try {
            await b.load()
        }
        catch(e){logger.debug(e)}
        return b;
    }

    constructor(
        previd: string | null,
        txids: string[],
        nonce: string,
        T: string,
        created: number,
        miner: string | undefined ,
        note: string | undefined,
        studentids: string[] | undefined
    ){
        this.previd = previd
        this.txids = txids
        this.nonce = nonce
        this.T = T
        this.created = created
        this.miner = miner
        this.note = note
        this.studentids = studentids
        this.blockid = objectManager.id(this.toNetworkObject())
    }
    
    toNetworkObject(): BlockType{
        const netObject: BlockType = {
            type: 'block',
            previd: this.previd,
            txids: this.txids,
            nonce: this.nonce,
            // note: this.note,
            T: this.T,
            created: this.created,
            // miner: this.miner,
        }

        if(this.note !== undefined){
            netObject.note = this.note
        }
        if(this.miner){
            netObject.miner = this.miner
        }
        if (this.studentids) {
            netObject.studentids = this.studentids
        }
        return netObject
    }

    checkPoW() : boolean {
      return BigInt(`0x${this.blockid}`) <= BigInt(`0x${this.T}`) 
    }

    isGenesis(): boolean {
        return this.previd === null
    }

    async getTxs(peer?: any): Promise<Transaction[]>{
        const txPromises: Promise<ApplicationObject>[] = []
        let retrievedObjects: ApplicationObject[] = []
        const txs: Transaction[] = []

        for (const txid of this.txids){
            txPromises.push(objectManager.fetch(txid, peer))
        }
        try{
            retrievedObjects = await Promise.all(txPromises)
        } catch (e) {
            throw new validationError('UNFINDABLE_OBJECT', `Retrieval of transactions of block ${this.blockid} failed; rejecting block. Reason: ${e}`)
        }
        logger.debug(`We have all ${this.txids.length} transactions of block ${this.blockid}`)
        for (const tx of retrievedObjects){
            if(!(isTransaction(tx) || isCoinbaseTransaction(tx))){
                    throw new validationError('UNFINDABLE_OBJECT', `Block reports a transaction with id ${objectManager.id(tx)}, but this is not a transaction.`) 
            }
            txs.push(Transaction.fromNetworkObject(tx))
        }

        return txs
    }

    async getParent(peer?: any): Promise<Block | null>{
        if(this.previd === null){
            return null
        }

        let parent : Block
        try{
            logger.debug(`Retrieving parent block of ${this.blockid} (${this.previd})`)
            const block = await objectManager.fetch(this.previd, peer)

            if(!isBlock(block)){
                throw new validationError('UNFINDABLE_OBJECT', `Got parent of block ${this.blockid}, but it was not of BlockObject type; rejecting block.`)
            }
            parent = await Block.fromNetworkObject(block)

            try{
                await parent.load()
                logger.debug(`Parent block ${this.previd} of the block ${this.blockid} is already cached.`)
            }
            catch{
                logger.debug(`Awaiting validation of the parent block ${this.previd} of the block ${this.blockid}.`)
                await parent.validate(peer)
            }
        }
        catch (e: any) {
            throw new validationError('UNFINDABLE_OBJECT', `Retrieval of block parent for block ${this.blockid} failed; rejecting block: ${e.message}`)
        }
        logger.debug(`Parent retrieve: ${parent.toString()}`)
        return parent
    }

    async validate(peer? : any){
        logger.debug(`Validating block ${this.blockid}`);
        // if(!checkBlockFormat(this.toNetworkObject())) throw new validationError(`INVALID_FORMAT`, `Block's ${this.blockid} format is invalid`)

        if(this.T != TARGET) throw new validationError(`INVALID_FORMAT`, `Block's ${this.blockid} target is invalid`)

        if(!this.checkPoW()) throw new validationError(`INVALID_BLOCK_POW`, `Block's ${this.blockid} proof-of-work is invalid`)

        let parentBlock: Block | null = null
        let stateBefore: UTXOSet | undefined

        if(this.isGenesis()){
            this.height=0;
            if(objectManager.id(this.toNetworkObject()) != genesisID){
                throw new validationError(`INVALID_GENESIS`, `Invalid genesis block ${this.blockid}: ${JSON.stringify(this.toNetworkObject())}`)
            }
            logger.debug(`Block ${this.blockid} is genesis block`)
            stateBefore = new UTXOSet(new Set<string>())
            logger.debug(`State before block ${this.blockid} is the genesis state`)
        }
        else{
            parentBlock = await this.getParent(peer)
            if(parentBlock === null){
                throw new validationError('UNFINDABLE_OBJECT', `Parent block of block ${this.blockid} was null`)
            }

            logger.debug(`Parent validation of ${this.blockid} successful.`)
            logger.debug(`Parent Block is ${parentBlock.toString()}`)

            const parentHeight = parentBlock.height
            if (parentHeight === undefined) {
                throw new validationError('UNFINDABLE_OBJECT', `Parent block ${parentBlock.blockid} of block ${this.blockid} has no known height`)
            }
            
            if(this.created <= parentBlock.created){
                throw new validationError('INVALID_BLOCK_TIMESTAMP', `Parent block ${parentBlock.blockid} created at ${parentBlock.created} has timestamp smaller than parent`)
            }
            
            const now = Math.floor(new Date().getTime() / 1000)
            if(this.created > now){
                throw new validationError('INVALID_BLOCK_TIMESTAMP', `Parent block ${parentBlock.blockid} created at ${parentBlock.created} has timestamp in the future`)
            }
            
            stateBefore = parentBlock.stateAfter?.copy()
            if(stateBefore === undefined){
                throw new validationError(`UNFINDABLE_OBJECT`, `Parent blocks state is not calculated. Current block : ${this.blockid}`)
            }

            this.height = parentHeight + 1
            logger.debug(`Block ${this.blockid} has height ${this.height}.`)

            // logger.debug(`Loaded state before block ${this.blockid}`)
            logger.debug(`State before block ${this.blockid} is ${stateBefore}`)
        }

        let coinbaseFound: boolean = false;
        let coinbase_tx : Transaction | null = null;
        let block_txs : Transaction[]
        try{
            block_txs = await this.getTxs(peer)
        }
        catch(e){
            logger.debug(`ERROR: ${e}`)
            throw e as validationError
        }

        // logger.debug(`\x1b[38;2;250;128;114mState before is ${stateBefore.toString()}\x1b[0m`)
        let state = stateBefore.copy()
        // logger.debug(`\x1b[38;2;250;128;114mState is ${state.toString()}\x1b[0m`)
        let fees = 0;
        for (let tx of block_txs){
            if(tx.isCoinbase()){
                if (coinbaseFound){
                    throw new validationError(`INVALID_BLOCK_COINBASE`, `More than one coinbase transaction found in block ${this.blockid}`)
                }
                if(this.txids.indexOf(tx.txid) != 0){
                    throw new validationError(`INVALID_BLOCK_COINBASE`, `Coinbase transaction is not at index 0 in txids in block ${this.blockid}`)
                }
                coinbaseFound = true
                coinbase_tx = tx
            }

            try{
                await tx.validate()
            }
            catch(e){
                throw e as validationError
            }

            await state.applyTransaction(tx)

            if(coinbaseFound && coinbase_tx != null && tx.txid != coinbase_tx.txid && tx.inputs.some(input => input.outpoint.txid === coinbase_tx!.txid )) {
                logger.debug(`Coinbase transaction ${coinbase_tx.txid} is spent in another transaction ${tx.txid} in the same block ${this.blockid}`)
                throw new validationError(`INVALID_TX_OUTPOINT`, `Coinbase transaction ${coinbase_tx.txid} is spent in another transaction ${tx.txid} in the same block ${this.blockid}`)
            }
            
            if(tx.fees === undefined){
                throw new validationError(`INTERNAL_ERROR`, `Transaction's ${tx.txid} fees not calculated`)
            }
            fees += tx.fees
        }

        if(coinbaseFound){
            if(coinbase_tx!.height != this.height){
                throw new validationError("INVALID_BLOCK_COINBASE", `Block's ${this.blockid} height is not one more than parent block ${parentBlock?.blockid} height ${parentBlock?.height}`)
            }

            if(coinbase_tx!.outputs[0]!.value > fees + BLOCK_REWARD){
                throw new validationError(`INVALID_BLOCK_COINBASE`, `Coinbase transaction output value ${coinbase_tx!.outputs[0]!.value} exceeds fees ${fees} plus block reward ${BLOCK_REWARD}`)
            }
        }

        logger.debug(`Block ${this.blockid} is valid`)
        this.stateAfter = state
        logger.debug(`State after Block ${this.blockid} is ${this.stateAfter.toString()} `)
        this.valid = true
        try{
            await this.save()
            await chainManager.onBlock(this)
        }
        catch(e){
            throw new validationError(`INTERNAL_ERROR`, `Something went wrong: ${e}`)
        }

        //TODO: maybe add a try catch to notifyblock or you can do it after
        
    }

    async save(){
        logger.debug(`Saving block ${this.blockid} metadata`);
        if(this.stateAfter === undefined){
            throw new Error(`Block's ${this.blockid} transactions are not applied`);
        }

        const metadata = { 
            height: this.height,
            stateAfterOutpoints:  Array.from(this.stateAfter.outpoints)
        };
        await db.put(`blockmeta:${this.blockid}`, metadata);
        logger.debug(`Stored valid block ${this.blockid} metadata: {height: ${metadata.height}, stateAfter: ${metadata.stateAfterOutpoints}}`);
    }

    async load(){
//        console.log(`Loading block ${this.blockid} metadata`)

        const { height, stateAfterOutpoints } = await db.get(`blockmeta:${this.blockid}`)
        this.height = height;
        this.stateAfter = new UTXOSet(new Set<string>(stateAfterOutpoints));
        this.valid = true;
    }

    toString() : string {
        return `Block: {previd: ${this.previd}, txids: ${this.txids}, blockid: ${this.blockid}, fees: ${this.fees}, stateAfter: ${this.stateAfter}, height: ${this.height}, valid: ${this.valid}}`
    }
}
