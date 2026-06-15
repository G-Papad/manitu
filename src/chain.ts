import { Block } from "./block";
import { genesisID } from "./HardCodedData";
import { logger } from "./logger";
import { mempool } from "./mempool";
import { chainEvents } from "./mining";
import { db, objectManager } from "./object";


class ChainManager{
    longestChainHeight: number = 0;
    tip: Block | null = null

    async init(){
        let savedTip: Block
        let height: number
        try{
            [savedTip, height] = await db.get('longestChain')
            logger.debug(`Longest chain loaded form db. Tip ${savedTip.blockid}, height: ${height}`)
        }
        catch{
            savedTip = await Block.makeGenesis()
            height = 0
            logger.debug(`Create longest chain. Initializing genesis block.`)
        }

        this.longestChainHeight = height
        this.tip = savedTip
        await this.save()
        logger.debug(`Chain manager initialized.`)
    }
    
    async save() {
        logger.debug(`Saving longest chain, new tip: ${this.tip?.toString()}`)
        await db.put('longestChain', [this.tip, this.longestChainHeight])
    }

    async onBlock(block: Block){
        if(!block.valid || block.height === undefined){
            throw new Error(`Invalid Block ${block.blockid}`);
        }

        if(block.height > this.longestChainHeight){
            logger.debug(`New longest chain height: ${block.height}. Tip: ${block.blockid}`)
            if(block.previd === this.tip?.blockid){
                logger.debug(` Block ${block.blockid} extends the longest chain`)
                await mempool.onBlockExtendingLongestChain(block)
                //Notify miner 
                chainEvents.emit("longestChainChanged", block)
            }
            else{
                const [_, fork1, fork2] = await Chain.findFork(this.tip!, block)
                //fork1 is the prevChain
                await mempool.reorg(fork1, fork2)
            }
            this.longestChainHeight = block.height;
            this.tip = block;
            await this.save()
        }
    }
}

export class Chain {
    blocks : Block[]

    constructor(blocks: Block[]){
        this.blocks = blocks
    }

    addBlock(block : Block){
        this.blocks.push(block)
    }

    reverse(){
        this.blocks.reverse()
    }

    static async findForkhelp(b1: Block, b2: Block, fork1: Chain = new Chain([]), fork2: Chain = new Chain([])) : Promise<[Block, Chain, Chain]>{
        logger.debug(`\x1b[38;2;250;128;114m-------Help-------\x1b[0m`)
        logger.debug(`Stage: B1 = ${b1.blockid}, B2 = ${b2.blockid}`)
        if(!b1.valid || !b2.valid){
            throw new Error(`Invalid block: B1: ${b1.blockid}: ${b1.valid}, B2: ${b2.blockid}: ${b2.valid}`)
        }

        if(b1.blockid === b2.blockid){
            return [b1, fork1, fork2]
        }


        if(b1.height === undefined || b2.height === undefined){
            throw new Error(`Block height is not defined: B1: ${b1.blockid}: ${b1.height}, B2: ${b2.blockid}: ${b2.height}`)
        }

        if(b1.height < b2.height){
            if(b2.previd === null){
                if(b2.blockid != genesisID){
                    throw new Error(`Invalid Chain with different genesis block`)
                }
                return [b2, fork1, fork2]
            }

            const b2parent = await objectManager.get(b2.previd)
            const b2parentBlock = await Block.fromNetworkObject(b2parent)
            fork2.addBlock(b2)
            await Chain.findForkhelp(b1, b2parentBlock, fork1, fork2)
        }
        else if(b1.height > b2.height){
            if(b1.previd === null){
                if(b1.blockid != genesisID){
                    throw new Error(`Invalid Chain with different genesis block`)
                }
                return [b1, fork1, fork2]
            }

            const b1parent = await objectManager.get(b1.previd)
            const b1parentBlock = await Block.fromNetworkObject(b1parent)
            fork1.addBlock(b1)
            await Chain.findForkhelp(b1, b1parentBlock, fork1, fork2)
        }
        else{
             if(b1.previd === null || b2.previd === null){
                if(b1.blockid != genesisID || b2.blockid != genesisID){
                    throw new Error(`Invalid Chain with different genesis block`)
                }
                return [b1, fork1, fork2]
            }
            const b1parent = await objectManager.get(b1.previd)
            const b1parentBlock = await Block.fromNetworkObject(b1parent)
            fork1.addBlock(b1)
            const b2parent = await objectManager.get(b2.previd)
            const b2parentBlock = await Block.fromNetworkObject(b2parent)
            fork2.addBlock(b2)
            await Chain.findForkhelp(b1parentBlock, b2parentBlock, fork1, fork2)
        }
        return [b1, fork1, fork2]
    }

    static async findFork(b1: Block, b2: Block) : Promise<[Block, Chain, Chain]>{
        logger.debug(`\x1b[38;2;250;128;114mFinding Forks for blocks: {${b1.blockid}, ${b2.blockid}}\x1b[0m`)
        let [lca, b1Fork, b2Fork] = await Chain.findForkhelp(b1, b2)
        b1Fork.reverse()
        b2Fork.reverse()
        return [lca, b1Fork, b2Fork]
    }
}

export const chainManager = new ChainManager()