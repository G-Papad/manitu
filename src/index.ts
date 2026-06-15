import { buildIndexes, startApi } from "./api";
import { chainManager } from "./chain";
import { mempool } from "./mempool";
import { miner } from "./mining";
import { network } from "./network";
import { syncAllFromLevelDB } from "./siteSync";

const PORT = 18018
const IP = '0.0.0.0'

async function start(){
  console.log("----------------------------------------------------------------------------------------------------------------")
  console.log("----------------------------------------------------------------------------------------------------------------")
  console.log("----------------------------------------------------------------------------------------------------------------")
  await chainManager.init()
  await mempool.init()
  await miner.start()
  network.init(IP, PORT)

  await buildIndexes()
  startApi()

  if (chainManager.tip) {
    syncAllFromLevelDB(chainManager.tip).catch(e =>
      console.warn(`siteSync startup failed: ${e.message}`)
    )
  }
}

start()
