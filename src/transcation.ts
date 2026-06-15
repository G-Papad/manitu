
import { validationError } from "./types";
import { CoinbaseTransactionType, hexToBytes, isCoinbaseTransaction, isHex32Bytes, isTransaction, Outpoint, toHex, TransactionInput, TransactionOutput, TransactionType, UnsignedTransaction } from "./types"
import { logger } from './logger'
import { canonicalize } from 'json-canonicalize'
import { objectManager } from "./object";

type Ed = typeof import('@noble/ed25519');
let _ed: Ed | null = null;
async function getEd(): Promise<Ed> {
    if (!_ed) {
        // @ts-ignore - ESM-only package loaded via dynamic import
        const { sha512 } = await import('@noble/hashes/sha2.js');
        _ed = await import('@noble/ed25519');
        _ed.hashes.sha512 = sha512;
    }
    return _ed;
}

export class Transaction {
    txid: string
    inputs: TransactionInput[] = []
    outputs: TransactionOutput[] = []
    height: number | null = null
    fees: number | undefined

    public static fromNetworkObject(object: TransactionType | CoinbaseTransactionType) : Transaction{
        let inputs: TransactionInput[] = [];
        let height: number | null = null;
        const txid = objectManager.id(object);

        if(isCoinbaseTransaction(object)){
            height = object.height;
        }
        else {
            if(!isTransaction(object)){
                logger.debug(`Object ${txid} is not a transaction`)
                throw new validationError("INVALID_FORMAT", `Object ${txid} is not a transaction`)
            }
            inputs = object.inputs;
        }
        const outputs = object.outputs;
        
        return new Transaction(txid, inputs, outputs, height);
    }

    constructor(
        txid: string,
        inputs: TransactionInput[] = [],
        outputs: TransactionOutput[] = [],
        height: number | null = null,
    ){
        this.txid = txid
        this.inputs = inputs
        this.outputs = outputs
        this.height = height
    }

    toNetworkObject() : TransactionType | CoinbaseTransactionType {
        let netObject: TransactionType | CoinbaseTransactionType
        if(this.isCoinbase() && this.height !== null){
            netObject = {
                type: "transaction",
                outputs: this.outputs,
                height: this.height
            }
        }
        else{
            netObject = {
                type: "transaction",
                inputs: this.inputs,
                outputs: this.outputs
            }
        }
        return netObject
    }

    async validate() {
        if(this.isCoinbase()){
            if (this.outputs.length != 1){
                throw new validationError("INVALID_FORMAT", `Coinbase transaction ${this.txid} has more than one output`)
            }
            const output: TransactionOutput | undefined = this.outputs[0];
            if(!output || !isHex32Bytes((output.pubkey))){
                throw new validationError("INVALID_FORMAT", `Coinbase transaction ${this.txid} output pubkey is invalid`)
            }
            this.fees = 0;
            return;
        }
        let outpoint: Outpoint;
        let sig: string | null;
        let input_trans: Transaction;
        let inputSum: number = 0;
        let txid: string;

        for (const input of this.inputs) {
            outpoint = input.outpoint;
            txid = outpoint.txid;
            sig = input.sig;
            try {
                input_trans = await objectManager.get(txid)                
            } catch (error) {
                console.log(`[DEBUG]: Cannot find tx ${txid} in inputs`)
                throw new validationError("UNKNOWN_OBJECT", `Referenced object ${txid} in transaction input not found.`)
            }
            if (!Array.isArray(input_trans.outputs) || input_trans.outputs.length <= outpoint.index) {
                    throw new validationError("INVALID_TX_OUTPOINT", `Invalid index of transaction ${txid}`)
            }

            // Validate the signature
            try {
                const msg = this.createUnsignedTransaction(this.toNetworkObject() as TransactionType);
                const sigBytes = hexToBytes(sig);
                const msgBytes = new TextEncoder().encode(canonicalize(msg));
                const pubkey = input_trans.outputs?.[outpoint.index]?.pubkey;
                
                if (typeof pubkey !== 'string') {
                    throw new validationError("INVALID_FORMAT", `Missing or invalid pubkey in tx ${txid}`)
                }
                const pubkeyBytes = hexToBytes(pubkey);
                const ok = await (await getEd()).verify(sigBytes, msgBytes, pubkeyBytes);
                if (!ok) {
                    throw new validationError("INVALID_TX_SIGNATURE", `Invalid transaction signature in tx ${txid}`)
                }
            } catch (error) {
                throw new validationError("INVALID_TX_SIGNATURE", `Invalid transaction signature in tx ${txid}`)
            }

            const referencedOutput = Array.isArray(input_trans.outputs) ? input_trans.outputs[outpoint.index] : undefined;
            if (referencedOutput !== undefined && typeof referencedOutput.value === 'number') {
                inputSum += referencedOutput.value;
            }
        }
        
        const outputSum = this.outputs.reduce((sum, output) => sum + output.value, 0);
        if (inputSum < outputSum) {
            throw new validationError("INVALID_TX_CONSERVATION", `Input sum is less than output sum in tx ${this.txid}`)
        }

        const seen = new Set<string>();
        for (const input of this.inputs) {
            const key = `${input.outpoint.txid}:${input.outpoint.index}`;
            if (seen.has(key)){ 
                throw new validationError(`INVALID_TX_OUTPOINT`, `Duplicate outpoint in inputs in tx ${this.txid}`)
            }
            seen.add(key);
        }

        this.fees = inputSum - outputSum;
        logger.debug(`\x1b[92mTransaction ${this.txid} is valid.\x1b[0m`)
        return;
    }

   
    createUnsignedTransaction(tx: TransactionType) : UnsignedTransaction {
        const unsigned : UnsignedTransaction  = {
            type: "transaction",
            inputs: tx.inputs.map(i => ({
                outpoint: i.outpoint,
                sig: null        
            })),
            outputs: tx.outputs
        };
        return unsigned;
    }

    async createTransaction(sk: string , input: Outpoint[], output: TransactionOutput[]) : Promise<TransactionType> {
        let inputs : TransactionInput[] = [];
        for (let inp of input){
            inputs.push({outpoint: inp, sig:"null"})
        }
        let msg : TransactionType = {type: "transaction", inputs: inputs, outputs: output}
        const enc_mes = new TextEncoder().encode(canonicalize(msg))
        const skBytes = hexToBytes(sk);
        const enc_signature = await (await getEd()).signAsync(enc_mes, skBytes);
        const sig = toHex(enc_signature);
        const real_inptus : TransactionInput[] = [];
        for (let inp of input){
            real_inptus.push({outpoint: inp, sig: sig})
        } 
        const ret : TransactionType = {
            type: "transaction",
            inputs: real_inptus,
            outputs: output
        };
        
        return ret;
    }

    isCoinbase(){
        return this.inputs.length === 0
    }

    toString() {
        return `<Transaction ${this.txid}>`
    }
}