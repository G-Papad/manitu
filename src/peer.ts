import { NAME } from "./HardCodedData";
import * as Net from 'net'
import { logger } from "./logger";
import { syncObject } from "./siteSync";
import { canonicalize } from "json-canonicalize";
import { ApplicationObject, ChainTipMessage, ErrorMessage, ErrorName, GetObjectMessage, IHaveObjectMessage, MempoolMessage, Message, MessageSchema, ObjectMessage, PeersMessage, validationError } from "./types";
import { network } from "./network";
import { objectManager } from "./object";
import { createChainTipMessage, createMempoolMessage, printMessage } from "./message";
import {createHelloMessage, createErrorMessage, createGetPeersMessage, createGetChainTipMessage, createGetMempoolMessage, createGetObjectMessage, createObjectMessage} from './message'
import { chainManager } from "./chain";
import { mempool } from "./mempool";
import { Block } from "./block";
import { Transaction } from "./transcation";


export class Peer{
    active: boolean = false
    socket: Net.Socket
    handshakeCompleted: boolean = false
    addr: string
    name: string = ""

    constructor(socket: Net.Socket){
        this.socket = socket
        if (socket.remoteAddress != undefined){
            this.addr = socket.remoteAddress
        }
        else{
            logger.debug(`Remote address is undefined`)
            throw new Error(`Remote address is undefined`)
        }
        this.setupSocket()
    }

    onConnect(){
        this.send(createHelloMessage("0.10.0", NAME));
        this.send(createGetPeersMessage());
        this.send(createGetChainTipMessage());
        this.send(createGetMempoolMessage());
    }

    setupSocket(){
const normalizedAddr = this.addr.replace('::ffff:', '')
//        if (normalizedAddr !== '45.32.235.245') {
//           logger.info(`Ignoring peer ${normalizedAddr} (not kalaburi)`)
//            this.socket.destroy()
//            return
//        }
    	    this.active = true
        let buffer = "";
        this.socket.on('data', async (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            const messages = buffer.split('\n')

            while (messages.length > 1) {
                let msg = messages.shift()
                if (msg === undefined) {
                    logger.error(`Error defragmenting messages`)
                    this.socket.end();
                    return
                }

                let message
                try {
                    message = JSON.parse(msg)
                } catch (error) {
                    logger.error(`Error parsing message as JSON`, message)
                    this.error("INVALID_FORMAT", "Message is not valid JSON.");
                    this.socket.end();
                    continue;
                }

                try{
                    message = MessageSchema.parse(message)
                } catch (e) {
                    logger.error(`Unknown protocol message`, message)
                    this.error("INVALID_FORMAT", "Unknown protocol message.")
                    this.socket.end();
                }

                printMessage(this.name, message)

                if(!this.handshakeCompleted){
                    if(message.type != 'hello'){
                        this.error("INVALID_HANDSHAKE", "First message must be a hello message.");
                        this.socket.end();
                    }
                    this.name = message.agent
                    logger.info(`Hello from ${this.name}`)
                    this.handshakeCompleted = true
                    continue
                }

                switch (message.type) {
                    case "hello":
                        logger.debug(`Again hello from ${this.name}`)
                        break;

                    case "getpeers":
                        this.handleGetPeersMessage()
                        break;

                    case "peers": 
                        this.handlePeersMessage(message as PeersMessage)
                        break;
                    case "ihaveobject":
                        this.handleIhaveObjectMessage(message as IHaveObjectMessage)
                        break;

                    case "getobject":
                        this.handleGetObjectMessage(message as GetObjectMessage)
                        break;

                    case "object":
                        this.handleObjectMessage(message as ObjectMessage)
                        break;

                    case "getchaintip":
                        this.handleGetChainTipMessage()
                        break;

                    case "chaintip":
                        this.handleChainTipMessage(message as ChainTipMessage)
                        break;

                    case "getmempool":
                        this.handleGetMempoolMessage()
                        break;

                    case "mempool":
                        this.handleMempoolMessage(message as MempoolMessage)
                        break;
                    
                    case "error":
                        logger.error(`[ERROR from ${this.name}: ${message.name}:${message.description}]`)
                        break

                    default:
                        this.error("INVALID_FORMAT", `Unhandled message type: ${message.type}`)
                        this.socket.end()
                }               
            }

            if (messages[0] === undefined) {
                console.error(`Error in parsing messages`)
                return
            }

            buffer = messages[0]
        })

        this.socket.on('error', () => {
            logger.error(`Socket with ${this.name} error`)
            this.fail()
            this.active = false
        })
        this.socket.on('end', () => {
            logger.debug(`Socket with ${this.name} ended`)
            this.active = false
        })
        this.socket.on('close', () =>{
            logger.debug(`Socket with ${this.name} closed`)
            this.active = false
            network.connectedPeers = network.connectedPeers.filter(p => p !== this);
        })
    }

    fail(){
        this.active = false
        this.socket.end()
        network.peerFailed(this.addr)
    }

    send(message: Message){
        if (message.type === 'peers') {
            logger.info(`Sending peers with ${message.peers.length} peers to ${this.name}`)
        } else {
            logger.info(`Sending message ${message.type} to peer ${this.name}`)
            logger.debug(`Sent message ${canonicalize(message)}`)
        }
        let msg = canonicalize(message);
        this.socket.write(msg + '\n');
    }

    error(name: ErrorName, description: string) {
      let errorMsg: ErrorMessage = createErrorMessage(name as ErrorName, description);
       console.log("[Sending] ", errorMsg);
       this.send(errorMsg);
    //    this.socket.end();
    }

    handleGetPeersMessage(){
        // logger.debug(`Sending peers: ${[...network.knownPeers]}`) 
        this.send({ type: "peers", peers: [...network.knownPeers] })
    }

    handlePeersMessage(msg: PeersMessage){
        for (const peer of msg.peers){
            network.peerDiscovered(peer)
        }
    }

    async handleIhaveObjectMessage(msg: IHaveObjectMessage){
        let objectID = msg.objectid;
        if( await objectManager.exists(objectID)) return ;
        const getObjectMsg = createGetObjectMessage(objectID);
        logger.debug(`Sending ${getObjectMsg}`)
        this.send(getObjectMsg)
    }

    async handleGetObjectMessage(msg: GetObjectMessage){
        let objectID = msg.objectid
        let storedobject : ApplicationObject | null = null
        try{
            storedobject = await objectManager.get(objectID)
        } catch {
            logger.debug(`Ask for not known object: ${objectID}`)
        }
        if(storedobject != null) {
            let objectMsg = createObjectMessage(storedobject); 
            logger.debug(`Sending ${objectMsg}`)
            this.send(objectMsg);   
        }
    }

    async handleObjectMessage(msg : ObjectMessage){
        let object = msg.object;
        let objectID = objectManager.id(object)
        // Check if we already have the object
        if( await objectManager.exists(objectID)){ 
            logger.debug(`Object ${objectID} found locally`)    
            return;
        }
        logger.debug(`New Object ${objectID}`)
        let instance : Block | Transaction
        try{
            instance = await objectManager.validate(object, this)
            // logger.debug(`[SOS]: objectID = ${objectID} InstanceId = ${objectManager.id(instance.toNetworkObject())} `)
            // await objectManager.put(instance.toNetworkObject())
            await objectManager.put(object)
            objectManager.notifyObjectStored(objectID, object)
            await syncObject(object, objectID, instance).catch(e =>
                logger.warn(`siteSync error for ${objectID.slice(0, 12)}...: ${e.message}`)
            )
            let ihaveMsg: IHaveObjectMessage = { type: "ihaveobject", objectid: objectID };
            await network.broadcast(ihaveMsg)
        }
        catch(e){
            logger.debug(`Validation of ${objectID} failed. Error: ${e}`)
            const err = (e as validationError)
            objectManager.notifyObjectFailed(objectID, err)
            this.error(err.name, err.description)
        }
    }

    handleGetChainTipMessage(){
        if(!chainManager.tip?.blockid) throw new Error(`Tip is not defined`)
            this.send(createChainTipMessage(chainManager.tip?.blockid))
    }

    async handleChainTipMessage(msg: ChainTipMessage){
        if(await objectManager.exists(msg.blockid)) {
            logger.debug(`Object with id ${msg.blockid} exists locally.`)
        }else{
            network.broadcast(createGetObjectMessage(msg.blockid))
        }
    }

    async handleGetMempoolMessage(){
        if( mempool.txIds === undefined){
            throw new Error(`Not initialized mempool`)
        }
        this.send(createMempoolMessage([...mempool.txIds]))
    }

    async handleMempoolMessage(msg : MempoolMessage){
        for (const txid of msg.txids){
            try{
                await objectManager.fetch(txid)
            }
            catch(e){
                const err = e as validationError
                this.error(err.name, err.description)
            }
        }
    }
}
