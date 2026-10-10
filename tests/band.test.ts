import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import Countdown from '../hooks/countdown'
import {
  AHEAD_COLOR,
  aheadLabel,
  buildLine,
  compactTokens,
  faceOf,
  resetLabel,
  type CountdownProps,
  type Meter,
} from '../hooks/line'

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

const usageWith = (fiveHourPercent: number, weekReset = WEEK_RESET) => ({
  startedAt: NOW,
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [
    {
      kind: 'five_hour',
      percentUsed: fiveHourPercent,
      resetsAt: new Date(FIVE_HOUR_RESET).toISOString(),
    },
    { kind: 'seven_day', percentUsed: 13, resetsAt: new Date(weekReset).toISOString() },
  ],
  cost: { usd: 1.08 },
})

const WAITING = { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] }

test('desktop band shows three meters and the cost', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(1) }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const meters = await ui.findAll({ type: 'Svg' })

  expect(texts).toEqual(['5h', '1%', 'wk', '13%', 'ctx', '8%', '83k', '$1.08'])
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

test('the band hands each countdown to a surface module with plain JSON props', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: usageWith(80) }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const clients = await ui.findAll({ type: 'Client' })
  const asksOf = (key: string) => clients.find(found => found.props.key === key)?.props

  expect(clients.map(found => found.props.key)).toEqual(['reset-5h', 'ahead-5h', 'reset-wk'])
  expect(clients.every(found => String(found.props.module).endsWith('countdown.tsx'))).toBe(true)
  expect(asksOf('reset-5h')?.props).toEqual({ kind: 'reset', resetsAtMs: FIVE_HOUR_RESET })
  expect(asksOf('ahead-5h')?.props).toEqual({
    kind: 'ahead',
    resetsAtMs: FIVE_HOUR_RESET,
    used: 80,
    windowSeconds: 5 * 3600,
  })
  expect(asksOf('reset-wk')?.props).toEqual({ kind: 'reset', resetsAtMs: WEEK_RESET })
  await ui.unmount()
})

test('a mounted countdown draws the text from the real clock and keeps ticking', async ($, on) => {
  const real = Date.now()
  mock.clock(on, { now: real })
  on('session.usage', () => ({
    value: {
      startedAt: real,
      context: { window: 1000000 },
      rateLimits: [
        {
          kind: 'five_hour',
          percentUsed: 1,
          resetsAt: new Date(real + (2 * 3600 + 6 * 60 + 53) * 1000).toISOString(),
        },
      ],
    },
  }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const shown = async () =>
    (await ui.findAll({ type: 'Text', in: 'reset-5h' })).map(found => found.text)

  expect(await shown()).toEqual([expect.stringMatching(/^↻ 2:06:5[0-3]$/)])
  await ui.advance(1000)
  expect(await shown()).toEqual([expect.stringMatching(/^↻ 2:06:5[0-3]$/)])
  await ui.unmount()
})

const countdownOf = (props: CountdownProps, state?: number) => {
  const timers: Array<{ ms: number; fn: () => void }> = []
  const stored: number[] = []
  const Text = (textProps: Record<string, unknown>) => ({ type: 'Text', props: textProps })
  const surface = {
    state,
    elements: { Text },
    every: (ms: number, fn: () => void) => {
      timers.push({ ms, fn })
      return () => undefined
    },
    setState: (next: number) => stored.push(next),
  }
  const tree = Countdown(props, surface as never) as unknown as {
    props: { children: string[]; color?: string; dimColor?: boolean }
  }

  return { timers, stored, props: tree.props }
}

const RESET_5H: CountdownProps = { kind: 'reset', resetsAtMs: FIVE_HOUR_RESET }
const AHEAD_5H: CountdownProps = {
  kind: 'ahead',
  resetsAtMs: FIVE_HOUR_RESET,
  used: 80,
  windowSeconds: 5 * 3600,
}

test('the countdown moves with the clock', () => {
  expect(countdownOf(RESET_5H, NOW).props).toEqual({ dimColor: true, children: ['↻ 2:06:53'] })
  expect(countdownOf(RESET_5H, NOW + 1000).props.children).toEqual(['↻ 2:06:52'])
})

test('the countdown starts one timer, only while it has no state, and the timer stores the instant', () => {
  const first = countdownOf(RESET_5H)
  const later = countdownOf(RESET_5H, NOW)
  const before = Date.now()

  first.timers[0]?.fn()

  expect(first.timers.map(timer => timer.ms)).toEqual([1000])
  expect(later.timers).toEqual([])
  expect(first.stored).toHaveLength(1)
  expect(first.stored[0]).toBeGreaterThanOrEqual(before)
  expect(first.stored[0]).toBeLessThanOrEqual(Date.now())
})

test('after the reset the countdown says now', () => {
  expect(countdownOf(RESET_5H, FIVE_HOUR_RESET - 1000).props.children).toEqual(['↻ 0:00:01'])
  expect(countdownOf(RESET_5H, FIVE_HOUR_RESET).props.children).toEqual(['↻ now'])
  expect(countdownOf(RESET_5H, FIVE_HOUR_RESET + 5000).props.children).toEqual(['↻ now'])
})

test('the countdown changes format across the one-day line', () => {
  const reset = new Date(2026, 9, 7, 15, 0, 0).getTime()
  const props: CountdownProps = { kind: 'reset', resetsAtMs: reset }

  expect(countdownOf(props, reset - 86400 * 1000 + 1000).props.children).toEqual(['↻ 23:59:59'])
  expect(countdownOf(props, reset - 86400 * 1000).props.children).toEqual(['↻ Wed 3pm'])
})

test('the pause reading is drawn in the pause color and moves with the clock', () => {
  const now = countdownOf(AHEAD_5H, NOW).props

  expect(now.color).toBe(AHEAD_COLOR)
  expect(now.dimColor).toBeUndefined()
  expect(now.children).toEqual([expect.stringMatching(/^1:06:5[23]$/)])
  expect(countdownOf(AHEAD_5H, NOW + 60 * 1000).props.children).toEqual([
    expect.stringMatching(/^1:05:5[23]$/),
  ])
})

const watched = (on: On, now = NOW) => {
  const clock = mock.clock(on, { now })
  const world = { usage: usageWith(1) as unknown, failing: false, redraws: 0 }
  on('ui.invalidate', (_$, e, next) => {
    world.redraws += 1
    return next(e)
  })
  on('session.usage', () => {
    if (world.failing) {
      throw new Error('usage unavailable')
    }

    return { value: world.usage as never }
  })

  return { clock, world }
}

test('the band starts one 15 second timer and never a 1 second one', async ($, on) => {
  const { clock, world } = watched(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.redraw()
  const seen: number[] = []

  for (let second = 1; second <= 30; second += 1) {
    if (second === 1) {
      world.usage = usageWith(2)
    }

    if (second === 16) {
      world.usage = usageWith(3)
    }

    await clock.advance(1000)
    seen.push(world.redraws)
  }

  expect(seen.slice(0, 14)).toEqual(Array(14).fill(0))
  expect(seen.slice(14, 29)).toEqual(Array(15).fill(1))
  expect(seen[29]).toBe(2)
  await ui.unmount()
})

test('between two 15 second ticks the band is not redrawn while the countdown advances', async ($, on) => {
  const { clock, world } = watched(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  world.usage = usageWith(2)
  await ui.advance(14_000)
  await clock.advance(14_000)
  expect(world.redraws).toBe(0)

  await clock.advance(1000)
  expect(world.redraws).toBe(1)

  world.usage = usageWith(3)
  await ui.advance(14_000)
  await clock.advance(14_000)
  expect(world.redraws).toBe(1)

  await clock.advance(1000)
  expect(world.redraws).toBe(2)
  await ui.unmount()
})

test('with the usage unchanged the 15 second ticks ask for no redraw', async ($, on) => {
  const { clock, world } = watched(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(15_000)
  await clock.advance(15_000)
  await clock.advance(30_000)

  expect(world.redraws).toBe(0)
  await ui.unmount()
})

const CHANGES = [
  { name: 'a percent', next: () => usageWith(2) },
  {
    name: 'the context tokens',
    next: () => ({ ...usageWith(1), context: { tokens: 83600, window: 1000000, percent: 8 } }),
  },
  { name: 'the cost', next: () => ({ ...usageWith(1), cost: { usd: 1.09 } }) },
]

for (const change of CHANGES) {
  test(`${change.name} that changed is redrawn once, at the next tick`, async ($, on) => {
    const { clock, world } = watched(on)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await clock.advance(15_000)
    expect(world.redraws).toBe(0)

    world.usage = change.next()
    await clock.advance(10_000)
    expect(world.redraws).toBe(0)

    await clock.advance(5000)
    expect(world.redraws).toBe(1)

    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(world.redraws).toBe(1)
    await ui.unmount()
  })
}

test('a clock move that does not move the tick by a pixel asks for no redraw, one that does asks for one', async ($, on) => {
  const { clock, world } = watched(on)
  world.usage = usageWith(1, NOW + 2 * 86_400_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(15_000)
  expect(world.redraws).toBe(0)

  await clock.advance(300_000)
  expect(world.redraws).toBe(1)
  await ui.unmount()
})

test('the pause row going away asks for one redraw', async ($, on) => {
  const { clock, world } = watched(on)
  world.usage = usageWith(65)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(3)

  await clock.advance(15_000)
  expect(world.redraws).toBe(0)

  await clock.advance(600_000)
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(2)
  expect(world.redraws).toBeGreaterThan(0)
  await ui.unmount()
})

test('the countdown crossing the one-day line asks for one redraw', async ($, on) => {
  const { clock, world } = watched(on)
  world.usage = usageWith(1, NOW + 86_400_000 + 20_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const widths = async () =>
    (await ui.findAll({ type: 'Box' }))
      .map(found => found.props.minWidth)
      .filter(width => width !== undefined)
  expect(await widths()).toEqual([2, 8, 2, 8, 2, 3])

  await clock.advance(15_000)
  expect(world.redraws).toBe(0)

  await clock.advance(15_000)
  expect(world.redraws).toBe(1)
  expect(await widths()).toEqual([2, 8, 2, 9, 2, 3])
  await ui.unmount()
})

test('the waiting state is a face: no redraw while waiting, one when the first reading arrives', async ($, on) => {
  const { clock, world } = watched(on)
  world.usage = WAITING

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(world.redraws).toBe(0)

  world.usage = usageWith(1)
  await clock.advance(15_000)
  expect(world.redraws).toBe(1)
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('a failing usage reading at a tick is swallowed and asks for nothing', async ($, on) => {
  const { clock, world } = watched(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  world.failing = true
  world.usage = usageWith(2)
  await clock.advance(15_000)
  expect(world.redraws).toBe(0)

  world.failing = false
  await clock.advance(15_000)
  expect(world.redraws).toBe(1)
  await ui.unmount()
})

const TURN = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the end of a turn with the usage unchanged asks for no redraw and returns the turn unchanged', async ($, on) => {
  const { world } = watched(on)
  on('turn.complete', () => ({ text: 'done', usage: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const result = await $.turn.complete(TURN)

  expect(result).toEqual({ text: 'done', usage: undefined })
  expect(world.redraws).toBe(0)
  await ui.unmount()
})

test('the end of a turn with the usage changed asks for one redraw and returns the turn unchanged', async ($, on) => {
  const { clock, world } = watched(on)
  on('turn.complete', () => ({ text: 'done', usage: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  world.usage = usageWith(2)
  const result = await $.turn.complete(TURN)

  expect(result).toEqual({ text: 'done', usage: undefined })
  expect(world.redraws).toBe(1)

  await clock.settle()
  await $.turn.complete(TURN)
  expect(world.redraws).toBe(1)
  await ui.unmount()
})

test('before the band has drawn anything the end of a turn asks for no redraw', async ($, on) => {
  const { world } = watched(on)
  on('turn.complete', () => ({ text: 'done', usage: undefined }))

  await $.turn.complete(TURN)

  expect(world.redraws).toBe(0)
})

test('a failing usage reading at the end of a turn is swallowed and the turn comes back unchanged', async ($, on) => {
  const { world } = watched(on)
  let completions = 0
  on('turn.complete', () => {
    completions += 1

    return { text: 'done', usage: undefined }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  world.failing = true
  world.usage = usageWith(2)
  const result = await $.turn.complete(TURN)

  expect(result).toEqual({ text: 'done', usage: undefined })
  expect(completions).toBe(1)
  expect(world.redraws).toBe(0)
  await ui.unmount()
})

test('the face leaves out the two texts the countdown module ticks by itself', () => {
  const at = (nowMs: number) => buildLine(usageWith(80) as never, nowMs)

  expect(at(NOW).meters[0]?.detail).not.toBe(at(NOW + 1000).meters[0]?.detail)
  expect(at(NOW).meters[0]?.ahead).not.toBe(at(NOW + 1000).meters[0]?.ahead)
  expect(faceOf(at(NOW))).toBe(faceOf(at(NOW + 1000)))
})

test('the face counts the pause row, the width class of the countdown and the waiting state', () => {
  const ahead = buildLine(usageWith(80) as never, NOW)
  const [fiveHour, ...rest] = ahead.meters as [Meter, ...Meter[]]
  const overDay = (nowMs: number) =>
    buildLine(usageWith(1, NOW + 86_400_000 + 20_000) as never, nowMs)

  expect(faceOf({ ...ahead, meters: [{ ...fiveHour, ahead: undefined }, ...rest] })).not.toBe(
    faceOf(ahead),
  )
  expect(faceOf(overDay(NOW))).not.toBe(faceOf(overDay(NOW + 30_000)))
  expect(faceOf(overDay(NOW))).toBe(faceOf(overDay(NOW + 1000)))
  expect(faceOf({ meters: [] })).not.toBe(faceOf(ahead))
  expect(faceOf({ meters: [] })).toBe(faceOf(buildLine(WAITING as never, NOW + 5000)))
})

test('the face counts the countdown props handed to the surface module', () => {
  const line = buildLine(usageWith(80) as never, NOW)
  const [fiveHour, ...rest] = line.meters as [Meter, ...Meter[]]
  const withMeter = (meter: Meter) => faceOf({ ...line, meters: [meter, ...rest] })

  expect(
    withMeter({ ...fiveHour, resetCountdown: { kind: 'reset', resetsAtMs: FIVE_HOUR_RESET + 1 } }),
  ).not.toBe(faceOf(line))
  expect(withMeter({ ...fiveHour, aheadCountdown: { ...AHEAD_5H, used: 81 } })).not.toBe(
    faceOf(line),
  )
})

test('the face counts the label of a meter', () => {
  const line = buildLine(usageWith(1) as never, NOW)
  const [fiveHour, ...rest] = line.meters as [Meter, ...Meter[]]

  expect(faceOf({ ...line, meters: [{ ...fiveHour, label: '5H' }, ...rest] })).not.toBe(faceOf(line))
})

test('the face counts the token detail of the context, which no module ticks', () => {
  const line = buildLine(usageWith(1) as never, NOW)
  const context = line.meters[2] as Meter

  expect(faceOf({ ...line, meters: [...line.meters.slice(0, 2), { ...context, detail: '84k' }] })).not.toBe(
    faceOf(line),
  )
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

test('while a survey holds the band a usage change asks for no redraw', async ($, on) => {
  const { clock, world } = watched(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'survey' }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.redraw({ ...BAND.props, hasSurvey: true })
  world.usage = usageWith(2)
  await clock.advance(15_000)
  await clock.advance(15_000)

  expect(world.redraws).toBe(0)
  await ui.unmount()
})
