import z from 'zod'

export const isHex32BytesRegex = /^[0-9a-f]{64}$/;
export const isHexUpTo32BytesRegex = /^[0-9a-f]{1,64}$/;
export const isValidAscii128Regex = /^[\x20-\x7E]*$/;
// export const isHexUpTo32BytesRegex = /^[0-9a-f]{1,64}$/;

const hex32Bytes = z.string().regex(isHex32BytesRegex, 'Must be 64 hex characters');
const hexUpTo32Bytes = z.string().regex(isHexUpTo32BytesRegex, 'Must be 1–64 hex characters');
const validAscii128 = z.string().max(128).regex(isValidAscii128Regex, 'Must be valid ASCII characters');

export const OutpointSchema = z.object({
  txid: hex32Bytes,
  index: z.number().int().nonnegative(),
}).strict()

export const TransactionInputSchema = z.object({
  outpoint: OutpointSchema,
  sig: z.string(),
}).strict()

export const TransactionOutputSchema = z.object({
  pubkey: hex32Bytes,
  value: z.number().nonnegative(),
}).strict()

export const TransactionSchema = z.object({
  type: z.literal('transaction'),
  inputs: z.array(TransactionInputSchema).min(1),
  outputs: z.array(TransactionOutputSchema),
}).strict()

export const CoinbaseTransactionSchema = z.object({
  type: z.literal('transaction'),
  height: z.number().int().nonnegative(),
  outputs: z.array(TransactionOutputSchema).length(1),
}).strict()

export const BlockSchema = z.object({
  type: z.literal('block'),
  T: hex32Bytes,
  created: z.number(),
  miner: validAscii128.optional(),
  nonce: hexUpTo32Bytes,
  note: validAscii128.optional(),
  previd: z.string().nullable(),
  txids: z.array(z.string()),
  studentids: z.array(validAscii128).max(10).optional(),
}).strict()

export const ApplicationObjectSchema = z.union([
  BlockSchema,
  TransactionSchema,
  CoinbaseTransactionSchema,
])


export const UnsignedTransactionSchema = z.object({
  type: z.literal("transaction"),
  inputs: z.array(
    z.object({
      outpoint: OutpointSchema,
      sig: z.null()
    })
  ),
  outputs: z.array(TransactionOutputSchema)
}).strict()

export type UnsignedTransaction = z.infer<typeof UnsignedTransactionSchema>;

export type Outpoint = z.infer<typeof OutpointSchema>;
export type TransactionInput = z.infer<typeof TransactionInputSchema>;
export type TransactionOutput = z.infer<typeof TransactionOutputSchema>;
export type TransactionType = z.infer<typeof TransactionSchema>;
export type CoinbaseTransactionType = z.infer<typeof CoinbaseTransactionSchema>;
export type BlockType = z.infer<typeof BlockSchema>;
export type ApplicationObject = z.infer<typeof ApplicationObjectSchema>;


// MESSAGES
export const ERROR_NAMES = z.enum([
  "INTERNAL_ERROR",
  "INVALID_FORMAT",
  "UNKNOWN_OBJECT",
  "UNFINDABLE_OBJECT",
  "INVALID_HANDSHAKE",
  "INVALID_TX_OUTPOINT",
  "INVALID_TX_SIGNATURE",
  "INVALID_TX_CONSERVATION",
  "INVALID_BLOCK_COINBASE",
  "INVALID_BLOCK_TIMESTAMP",
  "INVALID_BLOCK_POW",
  "INVALID_GENESIS",
])

export type  ErrorName = z.infer<typeof ERROR_NAMES>

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  name: z.enum([
    'INTERNAL_ERROR',
    'INVALID_FORMAT',
    'UNKNOWN_OBJECT',
    'UNFINDABLE_OBJECT',
    'INVALID_HANDSHAKE',
    'INVALID_TX_OUTPOINT',
    'INVALID_TX_SIGNATURE',
    'INVALID_TX_CONSERVATION',
    'INVALID_BLOCK_COINBASE',
    'INVALID_BLOCK_TIMESTAMP',
    'INVALID_BLOCK_POW',
    'INVALID_GENESIS',
  ]),
  description: z.string(),
}).strict()

export class validationError extends Error {
  name: ErrorName;
  description: string;

  constructor(name : ErrorName, description: string){
    super();
    this.name = name
    this.description = description
  }
}

export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;


export const HelloMessageSchema = z.object({
    type: z.literal('hello'),
    version: z.string().regex(/^0\.10\.\d+$/),
    agent: z.string().optional()
}).strict()

export const GetPeersMessageSchema = z.object({
  type: z.literal("getpeers"),
}).strict()

export const PeersMessageSchema = z.object({
  type: z.literal("peers"),
  peers: z.array(z.string()),
}).strict()

export const GetObjectMessageSchema = z.object({
  type: z.literal("getobject"),
  objectid: z.string(),
}).strict()

export const IHaveObjectMessageSchema = z.object({
  type: z.literal("ihaveobject"),
  objectid: z.string(),
}).strict()

export const ObjectMessageSchema = z.object({
    type: z.literal("object"),
    object: ApplicationObjectSchema,
}).strict()

export const GetMempoolMessageSchema = z.object({
    type: z.literal('getmempool')
}).strict()

export const MempoolMessageSchema = z.object({
    type: z.literal('mempool'),
    txids: z.array(z.string()),
}).strict()

export const GetChainTipMessageSchema = z.object({
  type: z.literal("getchaintip"),
}).strict()

export const ChainTipMessageSchema = z.object({
  type: z.literal("chaintip"),
  blockid: z.string(),
}).strict()

export const MessageSchema = z.discriminatedUnion('type', [
    HelloMessageSchema, 
    ErrorMessageSchema,
    GetPeersMessageSchema, 
    PeersMessageSchema, 
    GetObjectMessageSchema, 
    IHaveObjectMessageSchema, 
    ObjectMessageSchema, 
    GetMempoolMessageSchema, 
    MempoolMessageSchema, 
    GetChainTipMessageSchema, 
    ChainTipMessageSchema
])



export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type GetPeersMessage = z.infer<typeof GetPeersMessageSchema>;
export type PeersMessage = z.infer<typeof PeersMessageSchema>;
export type GetObjectMessage = z.infer<typeof GetObjectMessageSchema>;
export type IHaveObjectMessage = z.infer<typeof IHaveObjectMessageSchema>;
export type ObjectMessage = z.infer<typeof ObjectMessageSchema>;
export type GetMempoolMessage = z.infer<typeof GetMempoolMessageSchema>;
export type MempoolMessage = z.infer<typeof MempoolMessageSchema>;
export type GetChainTipMessage = z.infer<typeof GetChainTipMessageSchema>;
export type ChainTipMessage = z.infer<typeof ChainTipMessageSchema>;
export type Message = z.infer<typeof MessageSchema>;



export function isTransaction(obj: unknown): obj is TransactionType {
  return TransactionSchema.safeParse(obj).success
}

export function isCoinbaseTransaction(obj: unknown): obj is CoinbaseTransactionType {
  return CoinbaseTransactionSchema.safeParse(obj).success
}

export function isApplicationObject(obj: unknown): obj is ApplicationObject {
  return ApplicationObjectSchema.safeParse(obj).success
}

export function isBlock(obj: unknown): obj is BlockType {
  return BlockSchema.safeParse(obj).success
}

export function toHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

export function hexToBytes(hex: string): Uint8Array {
    return Buffer.from(hex, "hex");
}

export function isHex32Bytes(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}
