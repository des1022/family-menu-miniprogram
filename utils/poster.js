const config = require('./config.js')
const { db, fetchAll } = require('./cloud.js')
const { pad } = require('./util.js')
const { resolveCloudImages } = require('./image.js')

/**
 * 海报生成（Canvas 2D，1080 宽竖版，四模板）
 * 依赖页面传入 canvas node；图片走云存储临时链接
 */

/**
 * 四套配色 = 四种心情（版式是同一套「圆盘餐桌」）。
 * 只有颜色、没有各自的版式差异，所以 corner/bandH 这类字段已经不需要了。
 */
const PALETTES = {
  WARM:    { bg: '#FFF7EC', primary: '#E8592F', gold: '#E8A33D', ink: '#4A2B18', brown: '#8A5A33', cream: '#F3E3D2' },
  MINIMAL: { bg: '#FFFFFF', primary: '#262626', gold: '#B4B4B4', ink: '#1E1E1E', brown: '#6E6E6E', cream: '#F0F0F0' },
  FESTIVE: { bg: '#FFF6EB', primary: '#C0281B', gold: '#E0A63C', ink: '#601C12', brown: '#A8582A', cream: '#F1DFC8' },
  CUTE:    { bg: '#FFF6F8', primary: '#F26A8D', gold: '#F7B267', ink: '#7A3350', brown: '#B0708C', cream: '#FFE1E9' }
}

const W = 1080
const CAP = 6            // 圆盘最多摆 6 道（2 行 × 3）
const HEAD_H = 372       // 标题区（小圆点 + 标题 + 日期 + 副信息）高度
const ROW_GAP = 56       // 上下两行菜的间距

/**
 * 每次分享用的那句温馨话（首页那句「好好吃饭，慢慢生活」之外的一组）。
 * 都控制在 12 字以内 —— 海报标题按 78px 画，12 字正好一行放得下。
 */
const WARM_PHRASES = [
  '好好吃饭，慢慢生活',
  '今晚这桌，都是你爱吃的',
  '灶上有火，桌边有人',
  '一起吃顿饭，比什么都好',
  '一日三餐，四季有你',
  '家有烟火，日子才暖',
  '谁在家，就为谁下厨',
  '认真吃饭，好好生活',
  '家常便饭，最养人心',
  '热菜热饭，等你就好',
  '寻常日子，最是欢喜',
  '今晚的菜，都是家里味',
  '饭要一起吃才香',
  '把最好的留给你',
  '这一桌，刚好够暖',
  '锅里有饭，心里有底',
  '一家人，一顿饭',
  '今天也要好好待自己'
]

/** 随机挑一句温馨话（avoid 传当前这句，避免连点「换一句」出来还是同一句） */
function randomPhrase(avoid) {
  const pool = WARM_PHRASES.filter(t => t !== avoid)
  const list = pool.length ? pool : WARM_PHRASES
  return list[Math.floor(Math.random() * list.length)]
}

/** 今天日期中文：2026年9月9日 */
function dateCNFull(date) {
  const parts = String(date).split('-')
  return Number(parts[0]) + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日'
}

/** 顶部那行小字：几道菜 · 今晚几人在家吃（没人开伙就不写人数） */
function subText(count, eatCount) {
  const parts = [count + ' 道菜']
  if (Number(eatCount) > 0) parts.push('今晚 ' + eatCount + ' 人在家吃')
  return parts.join(' · ')
}

/** 按宽度自动缩字号（用户手打的标题可能超一行） */
function fitFont(ctx, text, maxW, startSize) {
  let size = startSize
  ctx.font = 'bold ' + size + 'px sans-serif'
  while (size > 40 && ctx.measureText(text).width > maxW) {
    size -= 4
    ctx.font = 'bold ' + size + 'px sans-serif'
  }
  return size
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

/** 批量换取云文件临时链接
 *
 * ⚠️ 这里以前是页面端直接 `wx.cloud.getTempFileURL` —— 但云存储桶是私有的，
 * 「管理员权限」只对云后台/服务端生效，客户端换链接会被权限拦掉。
 * 表现就是海报里别人的菜图读不到，只剩一个大大的首字色块（2026-10-12 截图看到）。
 * 必须和全站一样走云函数 img-url：见 utils/image.js 的 resolveCloudImages。
 */
async function tempUrls(fileIds) {
  return resolveCloudImages(fileIds.filter(Boolean))
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
 * 绘制海报（方案 C「圆盘餐桌」）
 *
 * 版式：顶部小圆点 + 一句温馨话 + 日期 + 「N 道菜 · 今晚 M 人在家吃」，
 * 中间把菜图裁成圆形摆成 1~2 行（像从上面看一桌菜），背景铺三层淡金同心圆当桌面，
 * 底部一条短线 + 底部文案 + 署名。
 *
 * @param canvas  canvas 2d node
 * @param lines   [{ dishName, dishImage(fileID), num }]
 * @param opts    { title, footer, date, variant, eatCount }
 * @returns 高度 H（供页面设置显示比例）
 */
async function drawPoster(canvas, lines, opts) {
  const ctx = canvas.getContext('2d')
  const p = PALETTES[opts.variant] || PALETTES.WARM

  const shown = lines.slice(0, CAP)
  const total = lines.length

  // 一行摆几个：3 道以内一行；4 道两行两列（圆最大）；5~6 道两行三列（圆缩小免得挨在一起）
  const rows = shown.length <= 3 ? 1 : Math.ceil(shown.length / 3)
  const cols = shown.length ? Math.ceil(shown.length / rows) : 1
  const R = shown.length === 1 ? 220 : (cols >= 3 ? 140 : 170)
  const stepX = 2 * R + (cols >= 3 ? 56 : 160)
  const nameGap = 26
  // 一格里：圆 + 菜名 + （份数那行也占位，不然两行上下会挤）
  const rowH = 2 * R + nameGap + 46 + 44 + ROW_GAP
  const gridH = shown.length ? rows * rowH - ROW_GAP : 0

  // 先算「内容自然有多高」，再决定留多少白 —— 菜少时海报会偏矮，
  // 这时候把多出来的空间上下均分进网格（而不是在底部留一大块空地）。
  const naturalH = HEAD_H + 78 + gridH + 270
  const H = Math.min(5200, Math.max(1440, Math.round(naturalH)))
  const shift = Math.max(0, Math.round((H - naturalH) / 2))

  const gridTop = HEAD_H + 78 + shift
  const gridBottom = gridTop + gridH
  const moreText = total > CAP ? '…… 还有 ' + (total - CAP) + ' 道菜，晚餐超丰盛' : ''
  const moreY = gridBottom + 78
  const lineY = gridBottom + (moreText ? 176 : 96)
  const footerY = lineY + 8 + 52 + 38
  const microY = footerY + 54

  canvas.width = W
  canvas.height = H
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, H)

  // 桌面同心圆（很淡，只为了让画面不空）
  const ringCy = (gridTop + gridBottom) / 2
  ctx.strokeStyle = 'rgba(232, 163, 61, 0.16)'
  ctx.lineWidth = 3
  ;[520, 390, 260].forEach(rr => {
    ctx.beginPath()
    ctx.arc(W / 2, ringCy, rr, 0, Math.PI * 2)
    ctx.stroke()
  })

  // 顶部四个小圆点
  const dotGap = 42
  const dotW = 4 * 16 + 3 * dotGap
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = p.gold
    ctx.beginPath()
    ctx.arc(W / 2 - dotW / 2 + 8 + i * (16 + dotGap), 104, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  // 标题（一句温馨话）/ 日期 / 副信息
  ctx.fillStyle = p.ink
  fitFont(ctx, opts.title, 900, 78)
  ctx.fillText(opts.title, W / 2, 218)
  ctx.fillStyle = p.brown
  ctx.font = '34px sans-serif'
  ctx.fillText(opts.date, W / 2, 292)
  ctx.font = '30px sans-serif'
  ctx.fillText(subText(total, opts.eatCount), W / 2, 344)

  if (!shown.length) {
    ctx.fillStyle = p.brown
    ctx.font = '46px sans-serif'
    ctx.fillText('今天还没有点单', W / 2, gridTop + 120)
    return H
  }

  // 预加载图片（走云函数换链接，见上面 tempUrls 的说明）
  const urls = await tempUrls(shown.map(l => l.dishImage))
  const imgs = []
  for (let i = 0; i < shown.length; i++) {
    const fid = shown[i].dishImage
    imgs.push(await loadImage(canvas, fid ? (urls[fid] || '') : ''))
  }

  for (let i = 0; i < shown.length; i++) {
    const line = shown[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = W / 2 + (col - (cols - 1) / 2) * stepX
    const cy = gridTop + R + row * rowH

    ctx.save()
    ctx.shadowColor = 'rgba(120, 80, 50, 0.22)'
    ctx.shadowBlur = 34
    ctx.shadowOffsetY = 14
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fillStyle = p.cream
    ctx.fill()
    ctx.restore()

    if (imgs[i]) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()
      // 居中裁成正方形填满圆
      const im = imgs[i]
      const s = Math.min(im.width, im.height)
      const sx = (im.width - s) / 2
      const sy = (im.height - s) / 2
      ctx.drawImage(im, sx, sy, s, s, cx - R, cy - R, R * 2, R * 2)
      ctx.restore()
    } else if (line.dishName) {
      ctx.fillStyle = p.primary
      ctx.font = '120px sans-serif'
      ctx.fillText(line.dishName.substring(0, 1), cx, cy + 42)
    }

    // 菜名（按圆直径收窄，太长就省）
    ctx.fillStyle = p.ink
    ctx.font = 'bold 40px sans-serif'
    let name = line.dishName || ''
    while (name.length > 1 && ctx.measureText(name + '…').width > R * 2 + 40) name = name.slice(0, -1)
    ctx.fillText(name + (name !== (line.dishName || '') ? '…' : ''), cx, cy + R + nameGap + 34)

    // 份数：圆下面一行小字（不是压在图上，圆里要留给照片）
    if (line.num > 1) {
      ctx.fillStyle = p.primary
      ctx.font = 'bold 26px sans-serif'
      ctx.fillText('×' + line.num, cx, cy + R + nameGap + 34 + 44)
    }
  }

  if (moreText) {
    ctx.fillStyle = p.brown
    ctx.font = '36px sans-serif'
    ctx.fillText(moreText, W / 2, moreY)
  }

  // 底部：短线 + 底部文案 + 署名
  ctx.fillStyle = p.gold
  roundRect(ctx, W / 2 - 80, lineY, 160, 8, 4)
  ctx.fill()
  ctx.fillStyle = p.ink
  ctx.font = '46px sans-serif'
  ctx.fillText(opts.footer, W / 2, footerY)
  ctx.fillStyle = p.brown
  ctx.font = '28px sans-serif'
  ctx.fillText('— 家庭菜单 · 一家人就要整整齐齐吃饭 —', W / 2, microY)

  return H
}

module.exports = {
  drawPoster: drawPoster,
  dateCNFull: dateCNFull,
  subText: subText,
  randomPhrase: randomPhrase,
  WARM_PHRASES: WARM_PHRASES,
  PALETTES: PALETTES
}
