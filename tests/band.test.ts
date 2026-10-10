import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { aheadLabel, compactTokens, resetLabel } from '../hooks/line'

const NOW = new Date(2026, 9, 6, 15, 0, 0).getTime()
const FIVE_HOUR_RESET = NOW + (2 * 3600 + 6 * 60 + 53) * 1000
const WEEK_RESET = new Date(2026, 9, 12, 0, 0, 0).getTime()

const BAND = {
  plugin: 'burnline-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const usageWith = (fiveHourPercent: number) => ({
  startedAt: NOW,
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [
    {
      kind: 'five_hour',
      percentUsed: fiveHourPercent,
      resetsAt: new Date(FIVE_HOUR_RESET).toISOString(),
    },
    { kind: 'seven_day', percentUsed: 13, resetsAt: new Date(WEEK_RESET).toISOString() },
  ],
  cost: { usd: 1.08 },
})

test('desktop band shows three meters and the cost', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(1) }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const meters = await ui.findAll({ type: 'Svg' })

  expect(texts).toEqual([
    '5h',
    '1%',
    '↻ 2:06:53',
    'wk',
    '13%',
    '↻ Mon 12am',
    'ctx',
    '8%',
    '83k',
    '$1.08',
  ])
  expect(meters.map(found => found.props.alt)).toEqual([
    '5h 1%, ↻ 2:06:53',
    'wk 13%, ↻ Mon 12am',
    'ctx 8%, 83k',
  ])
  expect(meters[0]?.props.source).toContain('<rect class="fill" x="0" y="3" width="3"')
  expect(meters[0]?.props.source).toContain('dark){.tick{fill:rgb(214,214,214)}.fill{fill:rgb(214,214,214)}}')
  expect(meters[2]?.props.source).toContain('dark){.tick{fill:rgb(214,214,214)}.fill{fill:rgb(219,210,190)}}')
  expect(meters[0]?.props.source).toContain('<rect class="tick" x="36" y="0"')
  expect(meters[2]?.props.source).not.toContain('class="tick"')
  expect((await ui.find({ type: 'Text', text: /^1%$/ }))?.props.color).toBeUndefined()
  expect(
    (await ui.findAll({ type: 'Box' }))
      .map(found => found.props.minWidth)
      .filter(width => width !== undefined),
  ).toEqual([2, 8, 2, 9, 2, 3])
  await ui.unmount()
})

test('a limit ahead of its clock takes the hot color and says by how much', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(80) }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const [fiveHour] = await ui.findAll({ type: 'Svg' })

  expect(fiveHour?.props.source).toContain('<rect class="fill" x="0" y="3" width="51"')
  expect(fiveHour?.props.source).toContain('.fill{fill:rgb(245,92,97)}}')
  expect((await ui.find({ type: 'Text', text: /^80%$/ }))?.props.color).toBe('rgb(245,92,97)')
  expect((await ui.find({ type: 'Text', text: /^1:06:5[23]$/ }))?.props.color).toBe('rgb(245,120,90)')
  expect((await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)).toEqual([
    expect.stringMatching(/^5h 80%, ↻ 2:06:53, pause 1:06:5[23]$/),
    'pause',
    'wk 13%, ↻ Mon 12am',
    'ctx 8%, 83k',
  ])
  await ui.unmount()
})

test('a limit far ahead of its clock reaches coral', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(95) }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const [fiveHour] = await ui.findAll({ type: 'Svg' })

  expect(fiveHour?.props.source).toContain('.fill{fill:rgb(245,80,100)}}')
  expect((await ui.find({ type: 'Text', text: /^95%$/ }))?.props.color).toBe('rgb(245,80,100)')
  await ui.unmount()
})

test('the countdown moves with the clock', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(1) }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(1000)

  expect(await ui.find({ type: 'Text', text: /2:06:52/ })).toBeDefined()
  await ui.unmount()
})

test('before any reading the band says it is waiting', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] },
  }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)

  expect(texts).toEqual(['Waiting for the first usage reading'])
  await ui.unmount()
})

test('the terminal keeps its own status line', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(1) }))
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, null, 'engine') as RenderElement)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ text: /engine/ })).toBeDefined()
  expect(await ui.find({ text: /5h/ })).toBeUndefined()
  await ui.unmount()
})

test('labels', () => {
  expect(resetLabel(NOW, NOW)).toBe('↻ now')
  expect(resetLabel(new Date(2026, 9, 12, 15, 0, 0).getTime(), NOW)).toBe('↻ Mon 3pm')
  expect(aheadLabel(60, 50, 5 * 3600)).toBe('0:30:00')
  expect(aheadLabel(60, 40, 7 * 86400)).toBe('1d 9:36:00')
  expect(compactTokens(1250000)).toBe('1.3M')
})
