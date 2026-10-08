#!/usr/bin/env node
/**
 * 把云环境里 5 个集合的权限设成「所有用户可读写」。
 *
 * 为什么需要它：
 *   微信云开发的 HTTP API（/tcb/databasecollectionadd 等 13 个接口）里**没有**
 *   任何权限接口，`componenttcb/dbmodifyacl` 又只对第三方平台开放，
 *   console.cloud.tencent.com 还要腾讯云账号 + 实名。
 *   唯一可行的自动化通道是腾讯官方的 CloudBase MCP（@cloudbase/cloudbase-mcp），
 *   它的 managePermissions 工具底层走 ModifyDatabaseACL / ModifySafeRule。
 *   本脚本就是一个"迷你 MCP 客户端"，把这些工具串起来跑。
 *
 * 用法：
 *   node tools/cloudbase-perm.mjs
 *   （首次会打印设备码 + 授权链接，用微信打开 → 选「使用微信公众平台账号登录」→ 授权）
 *
 * 为什么必须用「自定义安全规则」而不是四个简易权限：
 *   在四种简易权限下，小程序端**都不能修改他人创建的记录**。
 *   而这个 App 需要家人之间互相改对方的记录（买菜的人要勾掉做饭的人加的采购项、
 *   任何人要能撤掉别人点的菜），所以只能用 {"read": true, "write": true}。
 *   用简易权限不会报错，但家人之间互相看不到数据 —— 安静地坏掉，最难发现。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_ID = (fs.readFileSync(path.join(ROOT, 'utils', 'config.js'), 'utf8').match(/ENV_ID:\s*'([^']+)'/) || [])[1]
const COLLECTIONS = ['dishes', 'categories', 'records', 'members', 'shopping']
const RULE = '{"read": true, "write": true}'

if (!ENV_ID) {
  console.error('没能从 utils/config.js 读到 ENV_ID')
  process.exit(2)
}

/* ---------------- 迷你 MCP 客户端 ---------------- */

function startServer() {
  const isWin = process.platform === 'win32'
  return spawn(isWin ? 'npx.cmd' : 'npx', ['-y', '@cloudbase/cloudbase-mcp@latest'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TCB_SITE: 'domestic' },
    shell: isWin
  })
}

function makeClient(child) {
  let buf = ''
  let nextId = 100
  const pending = new Map()

  child.stdout.on('data', d => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let m
      try { m = JSON.parse(line) } catch (_) { continue }
      if (m.id && pending.has(m.id)) {
        const done = pending.get(m.id)
        pending.delete(m.id)
        done(m.result || m.error)
      }
    }
  })
  child.stderr.on('data', () => {})

  const raw = o => child.stdin.write(JSON.stringify(o) + '\n')

  function call(tool, args, waitMs = 90000) {
    const id = ++nextId
    return new Promise(resolve => {
      pending.set(id, resolve)
      raw({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ __timeout: true }) } }, waitMs)
    })
  }

  return { raw, call }
}

const textOf = r => {
  if (!r) return ''
  if (r.__timeout) return '(超时)'
  if (r.content && r.content.length) return r.content.map(c => c.text || '').join('\n')
  return JSON.stringify(r)
}
const statusOf = t => { try { return (JSON.parse(t) || {}).auth_status || '' } catch (_) { return '' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ---------------- 主流程 ---------------- */

const child = startServer()
const { raw, call } = makeClient(child)

try {
  raw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'family-menu', version: '1' } } })
  await sleep(2500)
  raw({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await sleep(600)

  let st = textOf(await call('auth', { action: 'status', site: 'domestic' }))
  let s = statusOf(st)
  console.log('环境 ID :', ENV_ID)
  console.log('登录状态:', s || '(读不到)')

  if (!s || s === 'REQUIRED' || s === 'PENDING') {
    const start = textOf(await call('auth', { action: 'start_auth', authMode: 'device', site: 'domestic' }))
    let ch = null
    try { ch = JSON.parse(start).auth_challenge } catch (_) {}
    if (!ch) {
      console.error('发起登录失败：', start.slice(0, 300))
      process.exit(1)
    }
    console.log('\n=====================================================')
    console.log('  请用微信打开下面的链接完成授权（10 分钟内有效）')
    console.log('  ' + ch.verification_uri)
    console.log('  设备码: ' + ch.user_code)
    console.log('  页面上选「使用微信公众平台账号登录」')
    console.log('=====================================================\n')

    for (let i = 0; i < 40; i++) {
      await sleep(15000)
      s = statusOf(textOf(await call('auth', { action: 'status', site: 'domestic' })))
      if (s && s !== 'REQUIRED' && s !== 'PENDING') { console.log('✓ 授权完成 (' + s + ')'); break }
      if (i % 4 === 3) console.log('  ...等待授权 ' + ((i + 1) * 15) + 's')
    }
  }

  if (!s || s === 'REQUIRED' || s === 'PENDING') {
    console.error('✗ 未完成授权，退出')
    process.exit(1)
  }

  const se = textOf(await call('auth', { action: 'set_env', envId: ENV_ID, site: 'domestic' }))
  console.log(se.replace(/\s+/g, ' ').slice(0, 200))

  const before = textOf(await call('queryPermissions', { action: 'getResourcePermission', resourceType: 'noSqlDatabase', resourceId: COLLECTIONS[0] }))
  try { console.log('改前 ' + COLLECTIONS[0] + ' 权限: ' + JSON.parse(before).data.aclTag) } catch (_) {}

  let fail = 0
  for (const c of COLLECTIONS) {
    const r = textOf(await call('managePermissions', {
      action: 'updateResourcePermission', resourceType: 'noSqlDatabase',
      resourceId: c, permission: 'CUSTOM', securityRule: RULE
    }))
    const ok = /"success"\s*:\s*true/.test(r)
    if (!ok) fail++
    console.log((ok ? '  ✓ ' : '  ✗ ') + c)
    await sleep(900)
  }

  console.log('\n复核：')
  for (const c of COLLECTIONS) {
    const r = textOf(await call('queryPermissions', { action: 'getResourcePermission', resourceType: 'noSqlDatabase', resourceId: c }))
    try {
      const d = JSON.parse(r).data
      const rule = ((d.permissions || [])[0] || {}).SecurityRule || ''
      console.log('  ' + c + '  aclTag=' + d.aclTag + '  rule=' + (rule || '(空)'))
    } catch (_) { console.log('  ' + c + '  ' + r.slice(0, 120)) }
  }

  console.log(fail ? '\n有 ' + fail + ' 个没设成功' : '\n🎉 全部完成')
  process.exit(fail ? 1 : 0)
} catch (e) {
  console.error('出错：', e && e.message ? e.message : e)
  process.exit(1)
} finally {
  try { child.kill() } catch (_) {}
}
