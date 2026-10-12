#!/usr/bin/env node
/**
 * 把海报代码「翻译」成图：调真实的 utils/poster.js 的 drawPoster，
 * 假 canvas 只记录绘制指令 → 生成 SVG → 用 Chrome 截成 PNG。
 *
 * 为什么要有它：本机没有微信开发者工具，海报是 canvas 画的。手抄坐标做预览图
 * 一定会抄错（2026-10-12 就抄错过一次：改完代码忘了同步预览稿）。
 * 这个脚本是**照着真实代码跑出来的**，改完 poster.js 重跑一次就行。
 *
 * 用法：
 *   node tools/preview-poster.mjs               # 4 道菜，WARM
 *   node tools/preview-poster.mjs 6 CUTE        # 6 道菜，可爱配色
 *   node tools/preview-poster.mjs 3 WARM outDir # 指定输出目录
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const nDish = Number(process.argv[2] || 4)
const variant = process.argv[3] || 'WARM'
const outDir = process.argv[4] || path.join(ROOT, '..', '_artifacts')

/* ---------------- 打桩：wx + 图片换链 ---------------- */
global.wx = { cloud: { init() {}, callFunction: async () => ({ result: { urls: {} } }) } }
const imgPath = path.join(ROOT, 'utils', 'image.js')
require.cache[imgPath] = {
  id: imgPath,
  filename: imgPath,
  loaded: true,
  exports: {
    // 真机上这里会换成云函数给的临时链接；预览里给个假地址，
    // 下面的 createImage 会立刻 onload，于是走「照片」那条分支（画成渐变块）
    resolveCloudImages: async fileIDs => {
      const out = {}
      ;(fileIDs || []).forEach(id => { if (id) out[id] = 'preview://' + id })
      return out
    }
  }
}

const poster = require(path.join(ROOT, 'utils', 'poster.js'))

/* ---------------- 假 canvas：把绘制指令录下来 ---------------- */
function makeCanvas() {
  const ops = []
  let pending = { arcs: [], pts: [] }
  const noop = () => {}
  const ctx = {
    font: '16px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'center',
    textBaseline: 'alphabetic',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    save: noop, restore: noop,
    translate: noop, rotate: noop,
    beginPath() { pending = { arcs: [], pts: [] } },
    closePath: noop,
    moveTo(x, y) { pending.pts.push([x, y]) },
    lineTo(x, y) { pending.pts.push([x, y]) },
    arcTo(x, y) { pending.pts.push([x, y]) },
    arc(cx, cy, r) { pending.arcs.push({ cx, cy, r }) },
    fillRect(x, y, w, h) { ops.push({ op: 'rect', x, y, w, h, fill: this.fillStyle }) },
    measureText(t) {
      const size = Number((this.font.match(/(\d+)px/) || [0, 16])[1])
      return { width: String(t).length * size }   // 中文按一个字≈1em
    },
    fill() {
      if (pending.arcs.length) {
        pending.arcs.forEach(a => {
          if (this.shadowBlur) {
            ops.push({ op: 'circle', cx: a.cx, cy: a.cy + (this.shadowOffsetY || 0), r: a.r, fill: 'rgba(120,80,50,0.16)' })
          }
          ops.push({ op: 'circle', cx: a.cx, cy: a.cy, r: a.r, fill: this.fillStyle })
        })
      } else if (pending.pts.length) {
        const xs = pending.pts.map(p => p[0])
        const ys = pending.pts.map(p => p[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        ops.push({ op: 'rect', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, fill: this.fillStyle, rx: 4 })
      }
      pending = { arcs: [], pts: [] }
    },
    stroke() {
      pending.arcs.forEach(a => ops.push({ op: 'circle', cx: a.cx, cy: a.cy, r: a.r, stroke: this.strokeStyle, sw: this.lineWidth }))
      pending = { arcs: [], pts: [] }
    },
    clip() {
      const a = pending.arcs[0]
      if (a) ops.push({ op: 'clipCircle', cx: a.cx, cy: a.cy, r: a.r })
    },
    drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh) {
      const c = ops.filter(o => o.op === 'clipCircle').slice(-1)[0]
      if (c) ops.push({ op: 'photo', cx: c.cx, cy: c.cy, r: c.r })
      else ops.push({ op: 'photo', cx: dx + dw / 2, cy: dy + dh / 2, r: dw / 2 })
    },
    fillText(t, x, y) {
      const size = Number((this.font.match(/(\d+)px/) || [0, 16])[1])
      ops.push({ op: 'text', t: String(t), x, y, size, fill: this.fillStyle, bold: /bold/.test(this.font) })
    }
  }
  return {
    canvas: {
      width: 0,
      height: 0,
      getContext: () => ctx,
      createImage: () => {
        const img = { width: 1200, height: 900 }
        Object.defineProperty(img, 'src', { set() { setTimeout(() => img.onload && img.onload(), 0) } })
        return img
      }
    },
    ops
  }
}

/* ---------------- 指令 → SVG ---------------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function toSvg(ops, W, H) {
  const body = []
  let photoIdx = 0
  // 照片用几个暖色渐变代替（真机上是他们的菜图）
  const grads = [
    ['#E7A176', '#C0613F'], ['#D8A25E', '#B4763A'], ['#9FBF8A', '#5F8F5C'],
    ['#8FB6C4', '#4B8CA0'], ['#C79A3C', '#9C6F22'], ['#D1899E', '#B0607C']
  ]
  const defs = grads.map((g, i) => `<linearGradient id="pg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g[0]}"/><stop offset="1" stop-color="${g[1]}"/></linearGradient>`).join('')
  ops.forEach(o => {
    if (o.op === 'rect') body.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.rx || 0}" fill="${o.fill}"/>`)
    if (o.op === 'circle') {
      body.push(o.stroke
        ? `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="none" stroke="${o.stroke}" stroke-width="${o.sw}"/>`
        : `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="${o.fill}"/>`)
    }
    if (o.op === 'photo') {
      const g = grads[photoIdx++ % grads.length]
      body.push(`<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="url(#pg${(photoIdx - 1) % grads.length})"/>`)
      void g
    }
    if (o.op === 'text') {
      body.push(`<text x="${o.x}" y="${o.y}" font-size="${o.size}" font-weight="${o.bold ? 'bold' : 'normal'}" fill="${o.fill}" text-anchor="middle" font-family="'Microsoft YaHei','PingFang SC',sans-serif">${esc(o.t)}</text>`)
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body.join('')}</svg>`
}

/* ---------------- 跑 ---------------- */
const { canvas, ops } = makeCanvas()
const lines = Array.from({ length: nDish }, (_, i) => ({
  dishName: ['红烧排骨', '青椒肉丝', '蒜蓉油麦菜', '紫菜蛋花汤', '番茄炒蛋', '凉拌黄瓜', '冬瓜排骨汤', '醋溜土豆丝'][i % 8],
  dishImage: 'cloud://preview/dish' + i + '.jpg',
  num: i === 2 ? 2 : 1
}))

const H = await poster.drawPoster(canvas, lines, {
  title: poster.randomPhrase(),
  footer: '今晚吃这些，幸福！',
  date: poster.dateCNFull('2026-10-12'),
  variant,
  eatCount: 2
})

const svg = toSvg(ops, canvas.width, H)
fs.mkdirSync(outDir, { recursive: true })
const svgPath = path.join(outDir, `海报预览-${nDish}道-${variant}.svg`)
const pngPath = path.join(outDir, `海报预览-${nDish}道-${variant}.png`)
fs.writeFileSync(svgPath, svg)

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#E6E0D8}svg{display:block;margin:20px}</style></head><body>${svg}</body></html>`
const htmlPath = path.join(os.tmpdir(), 'poster-preview.html')
fs.writeFileSync(htmlPath, html)

try {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=' + (canvas.width + 40) + ',' + (H + 40),
    '--screenshot=' + pngPath, 'file:///' + htmlPath.replace(/\\/g, '/')
  ], { stdio: 'ignore' })
  console.log('PNG:', pngPath)
} catch (e) {
  console.log('Chrome 截图失败（SVG 还在）:', e.message)
}
console.log('SVG:', svgPath)
console.log('画布尺寸:', canvas.width + '×' + H, '· 指令', ops.length, '条')
