#!/usr/bin/env node
/**
 * 把本次构建的版本号写进 utils/version.js。
 *
 * 为什么要有它：
 *   「应用内显示的版本」和「后台上传的版本号」必须是同一个数。以前前者写死在
 *   family.js、后者由 upload.js 用构建号拼，两边会分叉（手机上 v1.1.2、
 *   后台 1.0.57）。现在统一成：CI 先跑本脚本生成 utils/version.js，
 *   upload.js 和应用代码都从那里读 —— 只有一个来源，不可能再对不上。
 *
 * 用法（CI 里跑，本地一般不需要）：
 *   MP_BUILD=57 MP_SHA=abc1234 node scripts/stamp-version.js
 *
 * 环境变量：
 *   MP_BUILD  GitHub run_number（纯数字）→ 版本号 = 1.0.<run_number>
 *   MP_SHA    提交 SHA（取前 7 位，写进 desc 方便对照）
 */
const fs = require('fs')
const path = require('path')

const buildNo = process.env.MP_BUILD || ''
const version = /^\d+$/.test(buildNo) ? '1.0.' + buildNo : '1.0.0'
const sha = (process.env.MP_SHA || '').slice(0, 7)

const info = {
  version: version,
  build: buildNo,
  sha: sha,
  builtAt: new Date().toISOString()
}

const target = path.join(__dirname, '..', 'utils', 'version.js')
const body = [
  '/**',
  ' * 版本号 —— 全项目唯一事实来源。',
  ' * 本文件由 scripts/stamp-version.js 自动生成（构建时覆盖），不要手改。',
  ' * 生成时间：' + info.builtAt,
  ' * 对应提交：' + (sha || '(未知)'),
  ' */',
  'module.exports = ' + JSON.stringify(info, null, 2),
  ''
].join('\n')

fs.writeFileSync(target, body)
console.log('STAMPED version=' + version + (sha ? ' sha=' + sha : ''))
