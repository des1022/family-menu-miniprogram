#!/usr/bin/env node
/**
 * 初始化云环境：把缺的集合建出来。
 *
 * 用法：
 *   MP_APPSECRET=xxx node tools/init-env.mjs
 *   （APPID / ENV 可用同名环境变量覆盖；默认读本仓库的常量与 utils/config.js）
 *
 * 为什么需要 AppSecret：
 *   云开发「新建集合」只有服务端接口能调 —— 小程序端 `Database.createCollection()`
 *   官方标注「支持端：云函数」，客户端建不了表。服务端接口用 AppID + AppSecret
 *   换 access_token 即可调用。
 *
 * 为什么要单独一个脚本：
 *   环境的集合有可能被清掉/环境被重建（本仓库就遇到过：5 个集合全没了，
 *   小程序打开后什么都存不进去）。有这个脚本，重建就是一条命令。
 *
 * 注意：**集合权限这个脚本改不了**。微信云开发的 HTTP API 数据库章节
 * （databaseadd / databasequery / databasecollectionadd / ... 共 13 个）
 * 里没有任何「权限 / ACL / 安全规则」接口，官方只在控制台开放。
 * 所以建完集合后，仍需要在云开发控制台把 5 个集合的权限设为
 * 自定义安全规则：{"read": true, "write": true}（= 所有用户可读写）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const APPID = process.env.MP_APPID || process.env.APPID || 'wx83619ff082bae6bf'
const APPSECRET = process.env.MP_APPSECRET || process.env.APPSECRET || ''
const COLLECTIONS = ['dishes', 'categories', 'records', 'members', 'shopping']

/** 从 utils/config.js 里读 ENV_ID（单一事实来源在代码里，这里不重复维护） */
function readEnvId() {
  if (process.env.ENV_ID) return process.env.ENV_ID
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'config.js'), 'utf8')
  const m = src.match(/ENV_ID:\s*'([^']+)'/)
  if (!m) throw new Error('没能从 utils/config.js 里读到 ENV_ID')
  return m[1]
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error('接口返回的不是 JSON：' + text.slice(0, 200))
  }
}

async function main() {
  if (!APPSECRET) {
    console.error('缺少 AppSecret。用法：MP_APPSECRET=xxx node tools/init-env.mjs')
    console.error('（微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 / AppSecret）')
    process.exit(2)
  }

  const env = readEnvId()
  console.log('环境 ID :', env)
  console.log('AppID   :', APPID)
  console.log()

  // 1) 换 access_token
  const tokenRes = await fetch(
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    '&appid=' + encodeURIComponent(APPID) +
    '&secret=' + encodeURIComponent(APPSECRET)
  ).then(r => r.json())

  if (!tokenRes.access_token) {
    console.error('换 access_token 失败：', tokenRes.errcode, tokenRes.errmsg)
    if (tokenRes.errcode === 40125) console.error('→ AppSecret 不对（40125 invalid appsecret）')
    if (tokenRes.errcode === 40164) console.error('→ 当前机器 IP 不在白名单里')
    process.exit(1)
  }
  const token = tokenRes.access_token
  console.log('✓ access_token 已获取')
  console.log()

  const base = 'https://api.weixin.qq.com/tcb/'

  // 2) 看现在有哪些集合
  const before = await post(base + 'databasecollectionget?access_token=' + token, {
    env: env, limit: 100, offset: 0
  })
  if (before.errcode !== 0) {
    console.error('读取集合列表失败：', before.errcode, before.errmsg)
    process.exit(1)
  }
  const have = (before.collections || []).map(c => c.name)
  console.log('现有集合：', have.length ? have.join(', ') : '(一个都没有)')

  const missing = COLLECTIONS.filter(n => have.indexOf(n) === -1)
  if (!missing.length) {
    console.log('\n✓ 5 个集合都在，不需要新建。')
    console.log('  （权限仍需在控制台确认：自定义安全规则 {"read": true, "write": true}）')
    return
  }

  // 3) 逐个新建
  console.log('\n需要新建：', missing.join(', '))
  const failed = []
  for (const name of missing) {
    const r = await post(base + 'databasecollectionadd?access_token=' + token, {
      env: env, collection_name: name
    })
    if (r.errcode === 0) {
      console.log('  ✓ ' + name)
    } else {
      console.log('  ✗ ' + name + ' —— ' + r.errcode + ' ' + r.errmsg)
      failed.push(name)
    }
  }

  // 4) 复核
  const after = await post(base + 'databasecollectionget?access_token=' + token, {
    env: env, limit: 100, offset: 0
  })
  const now = (after.collections || []).map(c => c.name)
  console.log('\n现在集合列表：', now.join(', ') || '(空)')
  console.log()
  console.log('⚠️ 别忘了最后一步（接口做不到，只能控制台点）：')
  console.log('   云开发控制台 → 数据库 → 每个集合的权限 → 自定义安全规则')
  console.log('   {"read": true, "write": true}')

  if (failed.length) process.exit(1)
}

main().catch(e => {
  console.error('执行出错：', e && e.message ? e.message : e)
  process.exit(1)
})
