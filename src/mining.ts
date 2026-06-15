import { Block } from "./block";
import path from "path"
import { EventEmitter } from "events";
import { mempool } from "./mempool";
import { BlockType, CoinbaseTransactionType, IHaveObjectMessage } from "./types";
import { canonicalize } from "json-canonicalize";
import { genesisBlock, TARGET, MYPK, BLOCK_REWARD} from "./HardCodedData";
import { logger } from "./logger";
import { chainManager } from "./chain";
import { hash } from "./crypto";
import { objectManager } from "./object";
import { network } from "./network";
import { spawn, ChildProcess } from "child_process"
import { syncObject } from "./siteSync"


export const chainEvents = new EventEmitter();

const RUST_MINER_BIN = path.resolve(__dirname, '../miner/target/release/marabu-miner')

class Miner {
    id: string
    minerProcess: ChildProcess | null = null

    constructor(id: string){
        this.id = id

        chainEvents.on("longestChainChanged", (newTip: Block) =>{
            console.log(`New tip. Restart mining for tip: ${newTip.blockid}`)
            this.createNewWorker(newTip)
        })
    }

    collectTransaction(){
        if(mempool.txIds)
            return [...mempool.txIds]
        return []
    }

    async createCoinbase(height: number){
        const coinbase = {
            type: "transaction",
            height: height,
            outputs: [{pubkey: MYPK, value: BLOCK_REWARD}]
        } as CoinbaseTransactionType
        await objectManager.put(coinbase)
        return hash(canonicalize(coinbase))
    }

    buildBlock(previd: string | null, txids: string[], height: number): string {
        const b = {
            T: TARGET,
            created: Math.floor(Date.now() / 1000),
            miner: this.id,
            nonce: "",
            note: `Block at height ${height}`,
            previd: previd,
            txids: txids,
            type: 'block'
        }
        return canonicalize(b)
    }

    killMiner(){
        if (this.minerProcess) {
            this.minerProcess.kill()
            this.minerProcess = null
        }
    }

    async createNewWorker(block: Block){
	   return 
        const coinbaseId = await this.createCoinbase(block.height!+1)
        const memtxIds = this.collectTransaction()
        const txids = [coinbaseId, ...memtxIds]
        const toMine = this.buildBlock(block.blockid, txids, block.height!+1)
        this.killMiner()

        logger.info(`[MINING] Spawning Rust miner for height ${block.height!+1}`)
        const proc = spawn(RUST_MINER_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] })
        this.minerProcess = proc

        let outputBuf = ""

        proc.stdout!.on("data", (chunk: Buffer) => {
            outputBuf += chunk.toString()
            const lines = outputBuf.split('\n')
            outputBuf = lines.pop()!
            for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed.length > 0) {
                    this.handleFoundBlock(trimmed)
                }
            }
        })

        proc.stderr!.on("data", (chunk: Buffer) => {
            logger.debug(`[rust-miner] ${chunk.toString().trim()}`)
        })

        proc.on("error", (e) => {
            logger.error(`[MINING] Failed to start Rust miner: ${e.message}`)
        })

        proc.on("exit", (code, signal) => {
            if (signal !== 'SIGTERM' && signal !== null) {
                logger.debug(`[MINING] Rust miner exited with code=${code} signal=${signal}`)
            }
        })

        proc.stdin!.write(toMine + '\n')
        proc.stdin!.end()
    }

    async handleFoundBlock(blockStr: string){
        logger.info(`[MINING] Rust miner found block`)
        this.killMiner()
        const object = JSON.parse(blockStr)
        const objectID = objectManager.id(object)
        try{
            const instance = await objectManager.validate(object)
            await objectManager.put(object)
            await syncObject(object, objectID, instance).catch(e =>
                logger.warn(`siteSync error for mined block ${objectID.slice(0, 12)}...: ${e.message}`)
            )
            const ihaveMsg: IHaveObjectMessage = { type: "ihaveobject", objectid: objectID }
            await network.broadcast(ihaveMsg)
        } catch (e){
            logger.error(`[MINING]: Validation of ${objectID} failed. Error: ${e}`)
        }
    }

    async start(){
        logger.debug("Start mining")
        const tip = chainManager.tip
        if(tip != null) {
            console.log((tip.toString()) as string)
            logger.debug(`Start mine for tip: ${tip.toString()}`)
            this.createNewWorker(tip)
        }
        else {
            logger.debug("Start mine for genesis")
            const gen = await Block.fromNetworkObject(genesisBlock)
            this.createNewWorker(gen)
        }
    }
}


export const miner = new Miner("manitu")
