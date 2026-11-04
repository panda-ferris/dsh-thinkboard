// 颜色:用半透明填充,明暗主题下都可读;不使用字面色以外的主题依赖。
export const COLORS = {
  gray: { fill: 'rgba(128,128,128,0.12)', stroke: 'rgba(128,128,128,0.55)', dot: '#8a8f98' },
  red: { fill: 'rgba(239,68,68,0.12)', stroke: 'rgba(239,68,68,0.6)', dot: '#ef4444' },
  orange: { fill: 'rgba(249,115,22,0.12)', stroke: 'rgba(249,115,22,0.6)', dot: '#f97316' },
  yellow: { fill: 'rgba(234,179,8,0.14)', stroke: 'rgba(234,179,8,0.65)', dot: '#eab308' },
  green: { fill: 'rgba(34,197,94,0.12)', stroke: 'rgba(34,197,94,0.6)', dot: '#22c55e' },
  blue: { fill: 'rgba(59,130,246,0.12)', stroke: 'rgba(59,130,246,0.6)', dot: '#3b82f6' },
  purple: { fill: 'rgba(168,85,247,0.12)', stroke: 'rgba(168,85,247,0.6)', dot: '#a855f7' },
}
export const COLOR_NAMES = Object.keys(COLORS)

// 图形用:fill 'none' = 透明;'default' = 跟随主题。实色带适度透明,明暗主题都能看清。
export function shapeFill(name) {
  if (!name || name === 'none') return 'transparent'
  if (name === 'default') return 'var(--dsw-alias-bg-layer-1)'
  return COLORS[name] ? COLORS[name].fill.replace(/0\.1[24]\)/, '0.22)') : name
}
export function shapeStroke(name) {
  if (!name || name === 'default') return 'var(--dsw-alias-label-secondary)'
  if (name === 'none') return 'transparent'
  return COLORS[name] ? COLORS[name].dot : name
}
export const FILL_CHOICES = ['none', 'default', ...COLOR_NAMES]
export const STROKE_CHOICES = ['default', ...COLOR_NAMES, 'none']
