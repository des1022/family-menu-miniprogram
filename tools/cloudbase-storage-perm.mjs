#!/usr/bin/env node
/**
 * 把云环境的**云存储桶**权限设成「所有用户可读」（READONLY）。
 *
 * 为什么需要它：
 *   小程序里 A 账号上传的菜品图片，B 账号打开只能看到首字占位块 —
 *   因为文件读不到（只有上传者能看）。这不是代码能修的：客户端没有任何
 *   接口能改文件的 ACL，只能改环境侧的权限。
 *
 *   而 `tools/cloudbase-perm.mjs` 已经踩通了唯一可行的自动化通道：
 *   腾讯官方的 CloudBase MCP（@cloudbase/cloudbase-mcp）。
 *   它的 managePermissions 工具支持 resourceType="storage"，
 *   底层走 DescribeResourcePermission / ModifyResourcePermission。
 *   本脚本就是同一个通道，只是把目标从数据库集合换成云存储桶。
 *
 * 用法：
 *   node tools/cloudbase-storage-perm.mjs
 *   （首次会打印设备码 + 授权链接，用微信打开 → 选「使用微信公众平台账号登录」→ 授权）
 *
 * 权限取值（对齐 CloudBase 预置）：
 *   READONLY  = 所有用户可读，仅创建者可写   ← 本脚本用这个
 *   PRIVATE   = 仅创建者可读写
 *   ADMINWRITE= 所有用户可读，仅管理员可写
 *   ADMINONLY = 仅管理员可读写
 *
 * 生效时间：官方文档说改完 1-3 分钟生效，请稍等再看小程序。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_ID = (fs.readFileSync(path.join(ROOT, 'utils', 'config.js'), 'utf8').match(/ENV_ID:\s*'([^']+)'/) || [])[1]
const TARGET_PERMISSION = process.env.STORAGE_PERMISSION || 'READONLY'

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

/* ---------------- 从环境信息里找 bucket 名 ---------------- */

function findBuckets(text) {
  const out = []
  const re = /"(?:Bucket|bucket|Name|name)"\s*:\s*"([^"]*?)"/g
  let m
  while ((m = re.exec(text))) {
    const v = m[1]
    // 只看像 COS 桶名的（AppID 结尾，形如 xxx-1251234567）
    if (/-\d{6,}$/.test(v) && out.indexOf(v) < 0) out.push(v)
  }
  return out
}

/* ---------------- 主流程 ---------------- */

const child = startServer()
const { raw, call } = makeClient(child)

try {
  raw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'family-menu', version: '1' } } })
  await sleep(2500)
  raw({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await sleep(600)

  let s = statusOf(textOf(await call('auth', { action: 'status', site: 'domestic' })))
  console.log('环境 ID :', ENV_ID)
  console.log('登录状态:', s || '(读不到)')

  if (!s || s === 'REQUIRED' || s === 'PENDING') {
    const start = textOf(await call('auth', { action: 'start_auth', authMode: 'device', site: 'domestic' }))
    let ch = null
    try { ch = JSON.parse(start).auth_challenge } catch (_) {}
    if (!ch) {
      console.error('发起登录失败：', start.slice(0, 400))
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

  console.log(textOf(await call('auth', { action: 'set_env', envId: ENV_ID, site: 'domestic' })).replace(/\s+/g, ' ').slice(0, 200))

  // ---- 找 bucket ----
  const envInfo = textOf(await call('queryEnv', { action: 'info', envId: ENV_ID }))
  let buckets = findBuckets(envInfo)
  if (!buckets.length) {
    console.log('\n从环境信息里没直接认出 bucket，原始返回（前 1200 字）：')
    console.log(envInfo.slice(0, 1200))
    const listed = textOf(await call('queryStorage', { action: 'list', cloudPath: '' }))
    buckets = findBuckets(listed)
    if (!buckets.length) console.log('\n列目录也只拿到：', listed.slice(0, 600))
  }
  console.log('\n候选 bucket：', buckets.length ? buckets.join(', ') : '(没识别出来)')
  if (!buckets.length) {
    console.error('✗ 拿不到 bucket 名，无法继续。把上面的原始返回发我，我再适配解析。')
    process.exit(1)
  }

  // ---- 逐个 bucket 处理：查不到的（环境信息里会带出并不存在的静态托管桶）跳过；
  //      已经是目标值的就不重复改 ----
  const parse = t => { try { return JSON.parse(t) } catch (_) { return null } }
  let changed = 0

  for (const b of buckets) {
    const before = parse(textOf(await call('queryPermissions', { action: 'getResourcePermission', resourceType: 'storage', resourceId: b })))
    if (!before || before.success !== true) {
      console.log('\n跳过 [' + b + ']：' + ((before && before.message) || '查不到权限信息'))
      continue
    }
    const tag = (before.data || {}).aclTag
    console.log('\n[' + b + ']  当前 aclTag = ' + tag)

    if (tag === TARGET_PERMISSION) {
      console.log('  已经是 ' + TARGET_PERMISSION + '，不用改')
    } else {
      const r = textOf(await call('managePermissions', {
        action: 'updateResourcePermission',
        resourceType: 'storage',
        resourceId: b,
        permission: TARGET_PERMISSION
      }))
      const ok = /"success"\s*:\s*true/i.test(r) || /成功/.test(r)
      console.log((ok ? '  ✓ ' : '  ✗ ') + '设为 ' + TARGET_PERMISSION + ' → ' + r.replace(/\s+/g, ' ').slice(0, 220))
      if (!ok) continue
      changed++
      await sleep(1500)
    }

    // 复核：把权限明细完整打出来（能看清 read / write 各自放到了什么程度）
    const after = parse(textOf(await call('queryPermissions', { action: 'getResourcePermission', resourceType: 'storage', resourceId: b })))
    if (after && after.data) {
      console.log('  复核 aclTag = ' + after.data.aclTag + '（刚改完可能还没刷过来，1-3 分钟后再看一次）')
      console.log('  权限明细 = ' + JSON.stringify(after.data.permissions))
    }
  }

  console.log('\n改了 ' + changed + ' 个桶。存储权限改动 1-3 分钟后生效，重新打开小程序的菜库看看图片。')
  process.exit(0)
} catch (e) {
  console.error('出错：', e && e.message ? e.message : e)
  process.exit(1)
} finally {
  try { child.kill() } catch (_) {}
}
