// 从图片字节里读宽高(PNG / JPEG / GIF / WebP / SVG),不依赖任何库。读不出来返回 null。

export function imageDimensions(bytes) {
  const b = bytes
  if (!b || b.length < 10) return null
  const u16be = (i) => (b[i] << 8) | b[i + 1]
  const u32be = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const u16le = (i) => b[i] | (b[i + 1] << 8)
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
    const w = u32be(16), h = u32be(20)
    return w > 0 && h > 0 ? { w, h } : null
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    const w = u16le(6), h = u16le(8)
    return w > 0 && h > 0 ? { w, h } : null
  }
  // JPEG:扫描 SOFn 段
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
      const len = u16be(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = u16be(i + 5), w = u16be(i + 7)
        return w > 0 && h > 0 ? { w, h } : null
      }
      i += 2 + len
    }
    return null
  }
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 && b.length >= 30) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff }
    if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 } }
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    return null
  }
  // SVG:取 width/height,否则 viewBox
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 2048)))
  if (/<svg[\s>]/i.test(head)) {
    const tag = head.match(/<svg\b[^>]*>/i)?.[0] ?? ''
    const num = (name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)(?:px)?["']`, 'i')); return m ? parseFloat(m[1]) : null }
    const w = num('width'), h = num('height')
    if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) }
    const vb = tag.match(/viewBox\s*=\s*["']\s*[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i)
    if (vb && parseFloat(vb[1]) > 0 && parseFloat(vb[2]) > 0) return { w: Math.round(parseFloat(vb[1])), h: Math.round(parseFloat(vb[2])) }
  }
  return null
}
