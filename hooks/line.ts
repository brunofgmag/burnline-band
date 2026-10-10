import type { SessionRateLimit, SessionUsage } from 'claude-code'

export type Rgb = readonly [number, number, number]

export type Meter = {
  label: string
  percent: number
  clockPercent: number | null
  tone: number
  value: string
  detail?: string
  ahead?: string
}

export type Line = { meters: Meter[]; cost?: string }

export const METER_WIDTH = 64
export const METER_HEIGHT = 12
export const AHEAD_COLOR = 'rgb(245,120,90)'
export const PAUSE_WIDTH = 8
export const PAUSE_HEIGHT = 10
export const PAUSE_ICON = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${PAUSE_WIDTH}" height="${PAUSE_HEIGHT}" viewBox="0 0 ${PAUSE_WIDTH} ${PAUSE_HEIGHT}">`,
  `<rect x="0" y="0" width="3" height="${PAUSE_HEIGHT}" rx="1" fill="${AHEAD_COLOR}"/>`,
  `<rect x="5" y="0" width="3" height="${PAUSE_HEIGHT}" rx="1" fill="${AHEAD_COLOR}"/>`,
  '</svg>',
].join('')

const TRACK_HEIGHT = 6
const TICK_WIDTH = 2
const MIN_FILL = 3
const AHEAD_MARGIN = 5
const CELLS_PER_CHARACTER = 0.85
const DAY_SECONDS = 86400
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WINDOWS = [
  { kind: 'five_hour', label: '5h', seconds: 5 * 3600 },
  { kind: 'seven_day', label: 'wk', seconds: 7 * DAY_SECONDS },
]
const AMBER: Rgb = [245, 190, 70]
const NEUTRAL_ANY: Rgb = [140, 140, 140]
const NEUTRAL_DARK: Rgb = [214, 214, 214]
const NEUTRAL_LIGHT: Rgb = [74, 74, 74]

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

const css = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`

const blend = (from: Rgb, to: Rgb, share: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * share),
  Math.round(from[1] + (to[1] - from[1]) * share),
  Math.round(from[2] + (to[2] - from[2]) * share),
]

const isHot = (tone: number) => tone >= 0.5

const hotColor = (tone: number): Rgb => [
  245,
  Math.round(190 - (tone - 0.5) * 2 * 110),
  Math.round(70 + (tone - 0.5) * 2 * 30),
]

const fillColor = (tone: number, neutral: Rgb): Rgb =>
  isHot(tone) ? hotColor(tone) : blend(neutral, AMBER, tone * 2)

export const valueColor = (tone: number): string | undefined =>
  isHot(tone) ? css(hotColor(tone)) : undefined

const pad = (value: number) => String(value).padStart(2, '0')

export const hms = (seconds: number): string =>
  `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(Math.floor(seconds) % 60)}`

export const resetLabel = (resetsAtMs: number, nowMs: number): string => {
  const leftMs = resetsAtMs - nowMs

  if (leftMs <= 0) {
    return '↻ now'
  }

  if (leftMs < DAY_SECONDS * 1000) {
    return `↻ ${hms(leftMs / 1000)}`
  }

  const at = new Date(resetsAtMs)
  const hour = at.getHours()

  return `↻ ${WEEKDAYS[at.getDay()]} ${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`
}

export const aheadLabel = (used: number, clock: number, windowSeconds: number): string => {
  const seconds = ((used - clock) / 100) * windowSeconds

  return seconds >= DAY_SECONDS
    ? `${Math.floor(seconds / DAY_SECONDS)}d ${hms(seconds % DAY_SECONDS)}`
    : hms(seconds)
}

const clockPercent = (resetsAtMs: number, nowMs: number, windowSeconds: number): number => {
  const leftSeconds = Math.max(0, (resetsAtMs - nowMs) / 1000)

  return (clamp(windowSeconds - leftSeconds, 0, windowSeconds) / windowSeconds) * 100
}

const limitMeter = (
  label: string,
  windowSeconds: number,
  limit: SessionRateLimit,
  nowMs: number,
): Meter => {
  const used = limit.percentUsed
  const value = `${Math.round(used)}%`
  const resetsAtMs = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)

  if (Number.isNaN(resetsAtMs)) {
    return { label, percent: used, clockPercent: null, tone: clamp(used, 0, 100) / 100, value }
  }

  const clock = clockPercent(resetsAtMs, nowMs, windowSeconds)
  const isAhead = used - clock > AHEAD_MARGIN

  return {
    label,
    percent: used,
    clockPercent: clock,
    tone: clamp(0.5 - (clock - used) / 50, 0, 1),
    value,
    detail: resetLabel(resetsAtMs, nowMs),
    ...(isAhead ? { ahead: aheadLabel(used, clock, windowSeconds) } : {}),
  }
}

export const compactTokens = (tokens: number): string =>
  tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e3)}k`

const contextMeter = (tokens: number, window: number): Meter => {
  const percent = (tokens / window) * 100

  return {
    label: 'ctx',
    percent,
    clockPercent: null,
    tone: clamp(percent, 0, 100) / 100,
    value: `${Math.round(percent)}%`,
    detail: compactTokens(tokens),
  }
}

export const buildLine = (usage: SessionUsage, nowMs: number): Line => {
  const limits = WINDOWS.flatMap(({ kind, label, seconds }) => {
    const limit = usage.rateLimits.find(candidate => candidate.kind === kind)

    return limit === undefined ? [] : [limitMeter(label, seconds, limit, nowMs)]
  })
  const { tokens, window } = usage.context
  const hasContext = tokens !== undefined && window > 0
  const cost = usage.cost?.usd ?? 0

  return {
    meters: [...limits, ...(hasContext ? [contextMeter(tokens, window)] : [])],
    ...(cost > 0 ? { cost: `$${cost.toFixed(2)}` } : {}),
  }
}

const fillWidth = (percent: number): number => {
  const width = (clamp(percent, 0, 100) / 100) * METER_WIDTH

  return width > 0 ? Math.max(MIN_FILL, Math.round(width)) : 0
}

const meterStyle = (tone: number): string =>
  [
    '.track{fill:#8c8c8c;opacity:.3}',
    `.tick{fill:${css(NEUTRAL_ANY)}}`,
    `.fill{fill:${css(fillColor(tone, NEUTRAL_ANY))}}`,
    `@media (prefers-color-scheme:dark){.tick{fill:${css(NEUTRAL_DARK)}}.fill{fill:${css(fillColor(tone, NEUTRAL_DARK))}}}`,
    `@media (prefers-color-scheme:light){.tick{fill:${css(NEUTRAL_LIGHT)}}.fill{fill:${css(fillColor(tone, NEUTRAL_LIGHT))}}}`,
  ].join('')

export const meterSvg = (meter: Meter): string => {
  const trackY = (METER_HEIGHT - TRACK_HEIGHT) / 2
  const radius = TRACK_HEIGHT / 2
  const bar = (className: string, width: number) =>
    `<rect class="${className}" x="0" y="${trackY}" width="${width}" height="${TRACK_HEIGHT}" rx="${radius}"/>`
  const tickX =
    meter.clockPercent === null
      ? null
      : clamp(Math.round((meter.clockPercent / 100) * METER_WIDTH) - TICK_WIDTH / 2, 0, METER_WIDTH - TICK_WIDTH)
  const tick =
    tickX === null
      ? ''
      : `<rect class="tick" x="${tickX}" y="0" width="${TICK_WIDTH}" height="${METER_HEIGHT}" rx="${TICK_WIDTH / 2}"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${METER_WIDTH}" height="${METER_HEIGHT}" viewBox="0 0 ${METER_WIDTH} ${METER_HEIGHT}">`,
    `<style>${meterStyle(meter.tone)}</style>`,
    bar('track', METER_WIDTH),
    bar('fill', fillWidth(meter.percent)),
    tick,
    '</svg>',
  ].join('')
}

export const stableCells = (text: string): number => Math.ceil(text.length * CELLS_PER_CHARACTER)

export const meterAlt = (meter: Meter): string =>
  [
    `${meter.label} ${meter.value}`,
    meter.detail,
    meter.ahead === undefined ? undefined : `pause ${meter.ahead}`,
  ]
    .filter(Boolean)
    .join(', ')
