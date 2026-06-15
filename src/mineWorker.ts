import { parentPort, workerData } from "worker_threads"
import { hash } from "./crypto"
import { TARGET } from "./HardCodedData"
import { randomBytes } from "crypto";

function randomStartCounter(): number {
    const buf = randomBytes(8);
    let n = 0;
    for (let i = 0; i < 8; i++) n = (n << 8) | buf[i]!;
    return n >>> 0;
}

const block : string = workerData;

function mine(block : string){
    const nonceIndex = block.indexOf('"nonce":')
    const prefix = block.slice(0, nonceIndex + 9)
    const suffix = block.slice(nonceIndex+9)
    parentPort!.postMessage({type: "debug", note: `Mining for block ${prefix+suffix}`})
    let counter = randomStartCounter()
    const startCounter = counter
    let nonce = counter.toString(16).padStart(64, "0")
    while(true){
        const candidate = prefix + nonce + suffix
        if(BigInt(`0x${hash(candidate)}`) < BigInt(`0x${TARGET}`)){
            parentPort!.postMessage({
                type: "blockFound",
                block: candidate
            })
            return
        }
        ++counter
        nonce = counter.toString(16).padStart(64, "0")
        if((counter - startCounter) % 100_000_000 === 0){
            parentPort!.postMessage({type: "debug", note: (counter - startCounter).toString()})
        }
    }   
}

mine(block)
