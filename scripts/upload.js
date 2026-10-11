/**
 * 小程序上传/预览脚本（miniprogram-ci，无需微信开发者工具）
 *
 * 用法（两个环境变量）：
 *   MP_APPID=你的小程序AppID MP_KEY_PATH=私钥文件路径 node scripts/upload.js preview
 *   MP_APPID=... MP_KEY_PATH=... node scripts/upload.js upload   # 上传开发版本（用于设体验版）
 *
 * preview：生成预览二维码图片（开发者/体验成员可扫，二维码短效，适合当场验证）
 * upload ：上传代码到微信后台版本管理（之后在网页后台点「设为体验版」，家人长期扫码用）
 * both   ：一次构建同时做上面两件事 —— 二维码和后台版本号是同一个数，对得上
 *
 * 版本号从 utils/version.js 读（CI 先跑 scripts/stamp-version.js 生成），
 * 所以「应用内显示的版本」和「后台上传的版本号」永远一致。
 */
const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')
const buildInfo = require('../utils/version.js')

const WORKSPACE = path.resolve(__dirname, '..')
const QR_OUT = process.env.QR_OUT || path.join(WORKSPACE, 'preview-qr.png')

const APPID = process.env.MP_APPID
const KEY_PATH = process.env.MP_KEY_PATH
if (!APPID || !KEY_PATH || !fs.existsSync(KEY_PATH)) {
  console.error('缺少 MP_APPID 或 MP_KEY_PATH（私钥文件不存在）')
  process.exit(1)
}

// 把 project.config.json 的 appid 同步为上传 AppID
const cfgPath = path.join(WORKSPACE, 'project.config.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
if (cfg.appid !== APPID) {
  cfg.appid = APPID
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
}

async function main() {
  const project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: WORKSPACE,
    privateKeyPath: KEY_PATH,
    ignores: ['node_modules/**/*', 'scripts/**/*']
  })

  const mode = process.argv[2] || 'preview'
  const setting = { es6: true, es7: true, minified: true, autoPrefixWXSS: true }

  // 版本号从 utils/version.js 读（CI 先跑 scripts/stamp-version.js 生成），
  // 保证「应用内显示的版本」和「上传到后台的版本号」是同一个数。
  // 没跑 stamp 时退回老逻辑，避免本地手跑出个空版本号。
  const version = buildInfo.build
    ? buildInfo.version
    : (/^\d+$/.test(process.env.MP_BUILD || '') ? '1.0.' + process.env.MP_BUILD : '1.0.0')
  const sha = (process.env.MP_SHA || '').slice(0, 7)

  if (mode === 'preview' || mode === 'both') {
    await ci.preview({
      project: project,
      desc: '家庭菜单 ' + version + ' · ' + new Date().toLocaleString('zh-CN') + (sha ? ' · ' + sha : ''),
      setting: setting,
      qrcodeFormat: 'image',
      qrcodeOutputDest: QR_OUT,
      robot: 1,
      onProgressUpdate: () => {}
    })
    console.log('PREVIEW_OK version=' + version + ' qr=' + QR_OUT)
    if (mode === 'preview') return
  }

  const desc = '家庭菜单 ' + new Date().toLocaleString('zh-CN') + (sha ? ' · ' + sha : '')

  await ci.upload({
    project: project,
    version: version,
    desc: desc,
    setting: setting,
    robot: 1,
    onProgressUpdate: () => {}
  })
  console.log('UPLOAD_OK 版本 ' + version + ' 已上传，请到 mp 后台「版本管理」设为体验版')
}

main().catch(err => {
  console.error('FAILED:', err && err.message ? err.message : err)
  process.exit(1)
})
