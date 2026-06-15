import { canonicalize } from "json-canonicalize";
import { BlockType } from "./types";
import { hash } from "./crypto";



export const hardCodedIP = ["95.179.158.137:18018", "95.179.132.22:18018", "45.32.235.245:18018"];
// export const hardCodedIP = ['127.0.0.1'];

export const genesisBlock = createBlock(
    "00000000abc00000000000000000000000000000000000000000000000000000", 
    1771159355, 
    "Marabu", 
    "00dd82159556175752d9ba7349df67bddd237b59183747383f7b720e85c32347", 
    "Financial Times 2026-02-13: Crypto's battle with the banks is splitting Trump's base", 
    null, 
    [], 
    "block"
);

// export const genesisBlock = createBlock(
//     "00000000abc00000000000000000000000000000000000000000000000000000", 
//     1671062400, 
//     "Marabu", 
//     "000000000000000000000000000000000000000000000000000000021bea03ed", 
//     "The New York Times 2022-12-13: Scientists Achieve Nuclear Fusion Breakthrough With Blast of 192 Lasers", 
//     null, 
//     [], 
//     "block"
// );

console.log("[Genesis Block ID]: ", hash(canonicalize(genesisBlock)));
export const genesisID = hash(canonicalize(genesisBlock))

export function getTarget() : string {
    const target : string = "00000000abc00000000000000000000000000000000000000000000000000000";
    return target;
}

export const TARGET = getTarget()

export function getBlockReward(): number {
    const reward = 50000000000000; //50*10^12 picabu
    return reward;
}

export const BLOCK_REWARD = getBlockReward()

export const OBJECT_FETCH_TIMEOUT  = 7000;

export function createBlock(T: string,  created: number, miner: string, nonce: string, note: string, previd: string | null, txids: string[], type: string, studentids?: string[]) : BlockType{ 
  if(studentids === undefined) {
    return{
      type: "block",
      T: T,
      created: created,
      miner: miner,
      nonce: nonce,
      note: note,
      previd: previd,
      txids: txids 
    }
  }
  else {
    return{
      type: "block",
      T: T,
      created: created,
      miner: miner,
      nonce: nonce,
      note: note,
      previd: previd,
      txids: txids, 
      studentids: studentids
    }
  }
}

export const MYPK = "520b357dd1f23016625f3863b049a49c884fcef1a191647a1a3b17021aace357"

export const NAME = "manitu"

export const myIP = "95.179.132.22"