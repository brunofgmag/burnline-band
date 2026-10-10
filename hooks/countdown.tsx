import type { ClientModule } from 'claude-code'

import { AHEAD_COLOR, countdownLabel, type CountdownProps } from './line'

const TICK_MS = 1000

const Countdown: ClientModule<CountdownProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.every(TICK_MS, () => surface.setState(Date.now()))
  }

  const { Text } = surface.elements
  const label = countdownLabel(props, surface.state ?? Date.now())

  return props.kind === 'ahead' ? (
    <Text color={AHEAD_COLOR}>{label}</Text>
  ) : (
    <Text dimColor>{label}</Text>
  )
}

export default Countdown
