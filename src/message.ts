import {
  Message,
  HelloMessage,
  ErrorName,
  ErrorMessage,
  GetPeersMessage,
  GetObjectMessage,
  IHaveObjectMessage,
  ObjectMessage,
  GetChainTipMessage,
  ChainTipMessage,
  MempoolMessage,
  GetMempoolMessage,
  ApplicationObject,
  PeersMessage,
} from "./types";
import { logger } from "./logger";
import { canonicalize } from "json-canonicalize";

export function createHelloMessage(
  version = "0.10.0",
  agent?: string
): HelloMessage {
  return agent
    ? { type: "hello", version: version, agent: agent }
    : { type: "hello", version: version };
}

export function createErrorMessage(
  name: ErrorName,
  description: string
): ErrorMessage {
  return { type: "error", name: name, description: description };
}

export function createGetPeersMessage() : GetPeersMessage {
  return { type: "getpeers" };
}

export function createPeersMessage(peers: string[]) : PeersMessage {
  return { type: "peers", peers: peers };
}

export function createGetObjectMessage(objectid: string) : GetObjectMessage {
  return { type: "getobject", objectid: objectid };
}

export function createIHaveObjectMessage(objectid: string) : IHaveObjectMessage {
  return { type: "ihaveobject", objectid: objectid };
}

export function createObjectMessage(object: ApplicationObject) : ObjectMessage {
    return { type: "object", object: object };
}

export function createGetChainTipMessage() : GetChainTipMessage {
  return { type: "getchaintip" };
}

export function createChainTipMessage(blockid: string) : ChainTipMessage {
  return { type: "chaintip", blockid: blockid };
}

export function createGetMempoolMessage() : GetMempoolMessage {
  return { type: "getmempool" };
}

export function createMempoolMessage(txids: string[]) : MempoolMessage {
  return { type: "mempool", txids: txids };
}

export function printMessage(agent:string, msg: Message){
    if (msg.type === 'getpeers') return;
    const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
    if (msg.type === 'peers') {
        logger.debug(green(`[NEW MESSAGE]: Receive from ${agent} peers with ${msg.peers.length} peers`))
        return;
    }
    logger.debug(green(`[NEW MESSAGE]: Receive from ${agent} message:  ${String(canonicalize(msg))}`))
}
