/**
 * 云函数部署（miniprogram-ci，不需要微信开发者工具）
 *
 * 用法：
 *   MP_APPID=wx... MP_KEY_PATH=./private.key node scripts/deploy-functions.js
 *
 * 用的是同一把「小程序代码上传密钥」（它在微信后台的权限里包含上传云函数），
 * 云环境 ID 直接从 utils/config.js 读，避免多一个 secret。
 *
 * 什么时候跑：改了 cloudfunctions/ 下的代码就要跑一次。CI 里放在
 * 「上传版本 + 出预览码」之后 —— 万一云函数部署失败，也不耽误把小程序发出去，
 * 客户端本来就有「云函数不通就退回客户端分页」的兜底。
 */
const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')

const WORKSPACE = path.resolve(__dirname, '..')
const APPID = process.env.MP_APPID
const KEY_PATH = process.env.MP_KEY_PATH
const ENV_ID = process.env.MP_ENV_ID || require('../utils/config.js').ENV_ID

if (!APPID || !KEY_PATH || !fs.existsSync(KEY_PATH)) {
  console.error('缺少 MP_APPID 或 MP_KEY_PATH（私钥文件不存在）')
  process.exit(1)
}
if (!ENV_ID) {
  console.error('找不到云环境 ID（utils/config.js 的 ENV_ID）')
  process.exit(1)
}

// 需要部署的云函数（新增云函数记得加进来）
const FUNCTIONS = ['img-url', 'db-fetch']

async function main() {
  const project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: WORKSPACE,
    privateKeyPath: KEY_PATH,
    ignores: ['node_modules/**/*']
  })

  let failed = 0
  for (const name of FUNCTIONS) {
    const dir = path.join(WORKSPACE, 'cloudfunctions', name)
    if (!fs.existsSync(path.join(dir, 'index.js'))) {
      console.error(`[fn] 跳过 ${name}：云函数目录不存在`)
      failed++
      continue
    }
    try {
      console.log(`[fn] 上传 ${name} …`)
      const res = await ci.cloud.uploadFunction({
        project: project,
        env: ENV_ID,
        name: name,
        path: dir,
        remoteNpmInstall: true    // 依赖交给云端装，别把本地 node_modules 传上去
      })
      console.log(`[fn] ${name} 完成：`, JSON.stringify(res))
    } catch (e) {
      failed++
      console.error(`[fn] ${name} 失败：`, e && (e.message || e.errMsg || e))
    }
  }

  if (failed) {
    console.error(`[fn] 有 ${failed} 个云函数没传上去（小程序端会自动退回客户端分页，功能不受影响）`)
    process.exit(1)
  }
  console.log('[fn] 全部完成')
}

main().catch(e => {
  console.error('[fn] 运行失败', e)
  process.exit(1)
})
