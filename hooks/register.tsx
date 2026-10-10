import type { Register, SessionUsage, Timer } from 'claude-code'

import {
  buildLine,
  faceOf,
  meterAlt,
  meterSvg,
  METER_HEIGHT,
  METER_WIDTH,
  PAUSE_HEIGHT,
  PAUSE_ICON,
  PAUSE_WIDTH,
  stableCells,
  valueColor,
  type CountdownProps,
  type Meter,
} from './line'

const REFRESH_MS = 15_000
const LABEL_CELLS = 2

type Reading = () => Promise<[SessionUsage, number]>

const colorProps = (color: string | undefined) => (color === undefined ? {} : { color })

const countdownKey = (kind: CountdownProps['kind'], meter: Meter) => `${kind}-${meter.label}`

export const register: Register = on => {
  let refresh: Timer | undefined
  let drawn: string | undefined

  const redrawIfChanged = async (read: Reading, redraw: () => void) => {
    try {
      const [usage, nowMs] = await read()

      if (drawn !== undefined && faceOf(buildLine(usage, nowMs)) !== drawn) {
        redraw()
      }
    } catch {
      return
    }
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) {
      drawn = undefined

      return next(e)
    }

    refresh ??= $.clock.every(REFRESH_MS, () =>
      redrawIfChanged(
        () => Promise.all([$.session.usage(), $.clock.now()]),
        () => $.ui.invalidate('ui.render'),
      ),
    )

    const [usage, nowMs] = await Promise.all([$.session.usage(), $.clock.now()])
    const { Box, Svg, Text, Client } = $.ui.resolve(e)
    const line = buildLine(usage, nowMs)
    drawn = faceOf(line)
    const detailOf = (meter: Meter) =>
      meter.resetCountdown === undefined ? (
        <Text dimColor>{meter.detail}</Text>
      ) : (
        <Client
          key={countdownKey('reset', meter)}
          module="./countdown.tsx"
          props={meter.resetCountdown}
        />
      )

    if (line.meters.length === 0) {
      return (
        <Box paddingX={1}>
          <Text dimColor>Waiting for the first usage reading</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="flex-start" columnGap={4} paddingX={1}>
        {line.meters.map(meter => (
          <Box flexDirection="column">
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Box minWidth={LABEL_CELLS}>
                <Text dimColor>{meter.label}</Text>
              </Box>
              <Svg
                source={meterSvg(meter)}
                alt={meterAlt(meter)}
                width={METER_WIDTH}
                height={METER_HEIGHT}
              />
              <Text bold {...colorProps(valueColor(meter.tone))}>
                {meter.value}
              </Text>
              {meter.detail === undefined ? null : (
                <Box minWidth={stableCells(meter.detail)}>{detailOf(meter)}</Box>
              )}
            </Box>
            {meter.ahead === undefined ? null : (
              <Box flexDirection="row" alignItems="center" columnGap={1}>
                <Box minWidth={LABEL_CELLS} />
                <Svg source={PAUSE_ICON} alt="pause" width={PAUSE_WIDTH} height={PAUSE_HEIGHT} />
                <Client
                  key={countdownKey('ahead', meter)}
                  module="./countdown.tsx"
                  props={meter.aheadCountdown}
                />
              </Box>
            )}
          </Box>
        ))}
        {line.cost === undefined ? null : <Text dimColor>{line.cost}</Text>}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    await redrawIfChanged(
      () => Promise.all([$.session.usage(), $.clock.now()]),
      () => $.ui.invalidate('ui.render'),
    )

    return result
  })
}
