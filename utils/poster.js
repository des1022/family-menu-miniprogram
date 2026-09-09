const config = require('./config.js')
const { db, fetchAll } = require('./cloud.js')
const { pad } = require('./util.js')

/**
 * 海报生成（Canvas 2D，1080 宽竖版，四模板）
 * 依赖页面传入 canvas node；图片走云存储临时链接
 */

const PALETTES = {
  WARM:    { bg: '#FFF7EC', primary: '#E8592F', gold: '#E8A33D', ink: '#4A2B18', brown: '#8A5A33', cream: '#F3E3D2', corner: 26,  bandH: 26 },
  MINIMAL: { bg: '#FFFFFF', primary: '#262626', gold: '#B4B4B4', ink: '#1E1E1E', brown: '#6E6E6E', cream: '#F0F0F0', corner: 10,  bandH: 8 },
  FESTIVE: { bg: '#FFF6EB', primary: '#C0281B', gold: '#E0A63C', ink: '#601C12', brown: '#A8582A', cream: '#F1DFC8', corner: 26,  bandH: 30 },
  CUTE:    { bg: '#FFF6F8', primary: '#F26A8D', gold: '#F7B267', ink: '#7A3350', brown: '#B0708C', cream: '#FFE1E9', corner: 42,  bandH: 24 }
}

const W = 1080
const CELL_H = 444
const GRID_START = 412

/** 今天日期中文：2026年9月9日 */
function dateCNFull(date) {
  const parts = String(date).split('-')
  return Number(parts[0]) + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日'
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 批量换取云文件临时链接 */
async function tempUrls(fileIds) {
  const ids = fileIds.filter(Boolean)
  if (!ids.length) return {}
  const out = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const res = await wx.cloud.getTempFileURL({ fileList: chunk })
    ;(res.fileList || []).forEach(f => {
      if (f.fileID) out[f.fileID] = f.tempFileURL
    })
  }
  return out
}

/** 加载一张网络图为 Image 对象（失败返回 null） */
function loadImage(canvas, src) {
  return new Promise(resolve => {
    if (!src) return resolve(null)
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * 绘制海报
 * @param canvas  canvas 2d node
 * @param lines   [{ dishName, dishImage(fileID), num }]
 * @param opts    { title, footer, date, variant }
 * @returns 高度 H（供页面设置显示比例）
 */
async function drawPoster(canvas, lines, opts) {
  const ctx = canvas.getContext('2d')
  const p = PALETTES[opts.variant] || PALETTES.WARM

  const shown = lines.slice(0, 12)
  const rows = Math.max(0, Math.ceil(shown.length / 2))
  const contentBottom = GRID_START + rows * CELL_H
  const H = Math.min(5200, Math.max(1440, Math.round(contentBottom + 320)))
  canvas.width = W
  canvas.height = H

  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, H)

  // 顶部装饰
  ctx.fillStyle = p.primary
  ctx.fillRect(0, 0, W, p.bandH * (opts.variant === 'FESTIVE' ? 0.6 : 1))
  if (opts.variant === 'FESTIVE') {
    ctx.fillStyle = p.gold
    ctx.fillRect(0, p.bandH * 0.6, W, p.bandH * 0.4)
  } else if (opts.variant === 'CUTE') {
    ctx.fillStyle = p.gold
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.arc(130 + i * 220, p.bandH + 46, 12, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 标题 / 日期 / 分隔线
  ctx.textAlign = 'center'
  ctx.fillStyle = p.ink
  ctx.font = 'bold 82px sans-serif'
  ctx.fillText(opts.title, W / 2, p.bandH + 118)
  ctx.fillStyle = p.brown
  ctx.font = '44px sans-serif'
  ctx.fillText(opts.date, W / 2, p.bandH + 202)
  ctx.fillStyle = p.gold
  roundRect(ctx, W / 2 - 70, p.bandH + 280, 140, 10, 5)
  ctx.fill()

  // 菜品网格
  if (!shown.length) {
    ctx.fillStyle = p.brown
    ctx.font = '46px sans-serif'
    ctx.fillText('今天还没有点单', W / 2, GRID_START + 160)
    return H
  }

  // 预加载图片
  const urls = await tempUrls(shown.map(l => l.dishImage))
  const imgs = []
  for (let i = 0; i < shown.length; i++) {
    const fid = shown[i].dishImage
    imgs.push(await loadImage(canvas, fid ? (urls[fid] || '') : ''))
  }

  const imgSize = 320
  const x0 = 56
  const colW = 464
  const gap = 40

  for (let i = 0; i < shown.length; i++) {
    const line = shown[i]
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = x0 + col * (colW + gap)
    const y = GRID_START + row * CELL_H
    const ix = x + (colW - imgSize) / 2

    if (imgs[i]) {
      ctx.save()
      roundRect(ctx, ix, y, imgSize, imgSize, p.corner)
      ctx.clip()
      // 居中裁成方形
      const im = imgs[i]
      const s = Math.min(im.width, im.height)
      const sx = (im.width - s) / 2
      const sy = (im.height - s) / 2
      ctx.drawImage(im, sx, sy, s, s, ix, y, imgSize, imgSize)
      ctx.restore()
    } else {
      ctx.fillStyle = p.cream
      roundRect(ctx, ix, y, imgSize, imgSize, p.corner)
      ctx.fill()
      if (line.dishName) {
        ctx.fillStyle = p.primary
        ctx.font = '120px sans-serif'
        ctx.fillText(line.dishName.substring(0, 1), ix + imgSize / 2, y + imgSize / 2 + 42)
      }
    }

    // 菜名（单行省略）
    ctx.fillStyle = p.ink
    ctx.font = 'bold 44px sans-serif'
    let name = line.dishName || ''
    while (name.length > 1 && ctx.measureText(name + '…').width > colW) name = name.slice(0, -1)
    ctx.fillText(name + (name !== (line.dishName || '') ? '…' : ''), x + colW / 2, y + imgSize + 82)

    // 份数徽章
    if (line.num > 1) {
      const cx = ix + imgSize - 60
      const cy = y + 60
      ctx.fillStyle = p.primary
      ctx.beginPath()
      ctx.arc(cx, cy, 52, 0, Math.PI * 2)
      ctx.fill()
      if (opts.variant === 'FESTIVE') {
        ctx.strokeStyle = p.gold
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.arc(cx, cy, 46, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 48px sans-serif'
      ctx.fillText('×' + line.num, cx, cy + 17)
    }
  }

  if (lines.length > 12) {
    ctx.fillStyle = p.brown
    ctx.font = '36px sans-serif'
    ctx.fillText('…… 还有 ' + (lines.length - 12) + ' 道菜，晚餐超丰盛', W / 2, GRID_START + rows * CELL_H - 40)
  }

  // 底部
  const footerY = H - 260
  ctx.fillStyle = p.gold
  roundRect(ctx, W / 2 - 90, footerY, 180, 8, 4)
  ctx.fill()
  ctx.fillStyle = p.ink
  ctx.font = '50px sans-serif'
  ctx.fillText(opts.footer, W / 2, footerY + 96)
  ctx.fillStyle = p.brown
  ctx.font = '30px sans-serif'
  ctx.fillText(opts.variant === 'FESTIVE' ? '— 家宴开席 · 欢聚时刻 —' : '— 家庭菜单 · 一家人就要整整齐齐吃饭 —', W / 2, H - 80)

  return H
}

module.exports = {
  drawPoster: drawPoster,
  dateCNFull: dateCNFull,
  PALETTES: PALETTES
}
