import level from 'level-ts';
import * as Net from 'net'
import { hardCodedIP, myIP } from "./HardCodedData";
import { logger } from "./logger";
import { Peer } from "./peer";
import isValidHostname from 'is-valid-hostname'
import { Message } from "./types";

export const peerDB = new level("./peerDB");

export class Network{
    knownPeers: Set<string> = new Set()
    connectedPeers: Peer[] = []

    async init(ip: string, port: number){
        await this.peerLoad()
        logger.debug(`Known Peers: ${[...this.knownPeers]}`)

        const server = Net.createServer();
    
        server.on("connection", (socket: any) => {
            const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
            logger.info(yellow(`New connection from peer ${socket.remoteAddress}`))
            const peer = new Peer(socket)
            this.connectedPeers.push(peer)
            peer.onConnect()
        });
    
        server.listen(port, ip)
        this.connectToKnowPeers()
    }

    broadcast(msg: Message) {
        logger.info(`Broadcasting object to ${this.connectedPeers.length} peers: `, msg)
        this.printConnectedPeersByStatus()

        for (const peer of this.connectedPeers) {
            if (peer.active) {
                logger.debug(`Sending message to peer: ${peer.addr}`)
                peer.send(msg)
            }
        }
    }

    async peerLoad(){
        try {
            const stored = JSON.parse(await peerDB.get("peers"));
            if (Array.isArray(stored)) {
                this.knownPeers = new Set(stored)
            } else {
                this.knownPeers = new Set(hardCodedIP)
            }
        } catch (e) {
            logger.debug(`Using hardcoded peers`)
            this.knownPeers = new Set(hardCodedIP)
            await this.persistPeers();
        }
    }

    async persistPeers(): Promise<void> {
      try {
        await peerDB.put("peers", JSON.stringify([...this.knownPeers]));
      } catch (e) {
        console.error("Failed to persist peers:", e);
      }
    }

    async connectToKnowPeers(){
        for (const addr of this.knownPeers){
            // logger.info(`Attempting connection to known peer ${addr}`)
            const parsed = this.parsePeer(addr);
            if(!parsed) continue
            if(parsed.host == myIP) continue
            try{
                const client = this.createClient(addr)
                client.on('connect', async () => {
                    logger.info(`Connected to known peer ${addr}`)
                    const peer = new Peer(client)
                    peer.onConnect()
                    this.connectedPeers.push(peer)
                })

                client.on('error', (e) => {
                    // logger.error(`Failed to create connection to peer ${addr}: ${e.message}`)
                })

            }
            catch (e: any) {
                // logger.warn(`Failed to create connection to peer ${addr}: ${e.message}`)
            }
        }
    }

    createClient(addr: string){
        const parsed = this.parsePeer(addr);
        if (!parsed) throw new Error('Invalid port');

        const client = Net.connect({ host: parsed.host, port: parsed.port });

        // logger.debug(`Client for ${addr} has remote address: ${client.remoteAddress}`)
        return client
    }

    isValidPeerString(p: string): boolean {
        const i = p.lastIndexOf(":");
        if (i <= 0) return false;
        const host = p.slice(0, i).trim();
        if (!isValidHostname(host)){
            // logger.warn(`I got invalid peer ${host}; skipping`)
            return false
        }
        const portStr = p.slice(i + 1).trim();
        const n = Number(portStr);
        return host.length > 0 && Number.isInteger(n) && n > 0 && n <= 65535;
    }

    parsePeer(p: string): { host: string; port: number } | null {
        const normalized_address = this.normalizePeerAddress(p)
        if (!this.isValidPeerString(normalized_address)) return null;
        const i = normalized_address.lastIndexOf(":");
        return { host: normalized_address.slice(0, i).trim(), port: Number(normalized_address.slice(i + 1).trim()) };
    }

    normalizePeerAddress(address: string): string {
        if (address.startsWith('::ffff:')) {
            return address.substring(7);
        }
        return address;
    }

    peerDiscovered(peerAddr: string){
        const parsed = this.parsePeer(peerAddr)
        if(!parsed){
            // logger.warn(`Parsed peers failed`)
            return
        }
	//if (parsed.host !== '45.32.235.245') {
	//	return
	//}	
       if(parsed.host == 'localhost'){
            logger.warn(`Dont accept localhost`)
         return
        }
        // this.knownPeers.add(`${parsed.host}:${parsed.port}`)
        const key =`${parsed.host}:${18018}`
        if(this.knownPeers.has(key)) return
        this.knownPeers.add(key)
        this.persistPeers()
        // logger.info(`Known peers: ${this.knownPeers.size}`)
    }

    peerFailed(peerAddr: string){
        logger.warn(`Removing ${peerAddr}`)
        this.knownPeers.delete(peerAddr)
        this.persistPeers()
        // logger.info(`Known peers: ${this.knownPeers.size}`)
    }

    printConnectedPeersByStatus() {
        const active: string[] = [];
        const inactive: string[] = [];

        for (const p of this.connectedPeers) {
            const host = this.normalizePeerAddress(p.addr);
            const port = p.socket.remotePort;

            const addrPort = `${host}:${port ?? "?"}`;
            (p.active ? active : inactive).push(addrPort);
        }

        console.log(`Active (${active.length}): ${active.join(", ") || "-"}`);
        console.log(`Inactive (${inactive.length}): ${inactive.join(", ") || "-"}`);
    }
}

export const network = new Network()
