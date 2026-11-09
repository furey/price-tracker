export const TICK_INTERVAL_MS = 15 * 60 * 1000

export const startDaemon = ({
  runTick,
  log,
  intervalMs = TICK_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  let timer = null
  let stopped = false
  let inFlight = Promise.resolve()

  const cycle = async () => {
    try {
      await runTick()
    } catch (error) {
      log(`tick failed: ${error.message}`)
    }
    if (!stopped) timer = setTimer(() => { inFlight = cycle() }, intervalMs)
  }

  inFlight = cycle()

  const stop = () => {
    stopped = true
    clearTimer(timer)
    return inFlight
  }

  return { stop }
}
