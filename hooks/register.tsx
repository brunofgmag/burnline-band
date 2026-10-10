import type { Register, Timer } from 'claude-code'

import {
  AHEAD_COLOR,
  buildLine,
  meterAlt,
  meterSvg,
  METER_HEIGHT,
  METER_WIDTH,
  PAUSE_HEIGHT,
  PAUSE_ICON,
  PAUSE_WIDTH,
  stableCells,
  valueColor,
} from './line'

const REFRESH_MS = 1000
const LABEL_CELLS = 2

const colorProps = (color: string | undefined) => (color === undefined ? {} : { color })

export const register: Register = on => {
  let refresh: Timer | undefined

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) {
      return next(e)
    }

    refresh ??= $.clock.every(REFRESH_MS, () => $.ui.invalidate('ui.render'))

    const [usage, nowMs] = await Promise.all([$.session.usage(), $.clock.now()])
    const { Box, Svg, Text } = $.ui.resolve(e)
    const line = buildLine(usage, nowMs)

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
                <Box minWidth={stableCells(meter.detail)}>
                  <Text dimColor>{meter.detail}</Text>
                </Box>
              )}
            </Box>
            {meter.ahead === undefined ? null : (
              <Box flexDirection="row" alignItems="center" columnGap={1}>
                <Box minWidth={LABEL_CELLS} />
                <Svg source={PAUSE_ICON} alt="pause" width={PAUSE_WIDTH} height={PAUSE_HEIGHT} />
                <Text color={AHEAD_COLOR}>{meter.ahead}</Text>
              </Box>
            )}
          </Box>
        ))}
        {line.cost === undefined ? null : <Text dimColor>{line.cost}</Text>}
      </Box>
    )
  })
}
