import type { ClientModule } from 'claude-code'

// An invisible region laid over the row. It tells the hooks module when the pointer enters
// and leaves (the row's hover state), and when a left click is pressed and released inside.
let isPressed = false

const ClickArea: ClientModule = (_props, surface) => {
  surface.onPointer(event => {
    if (event.type === 'enter') surface.post({ type: 'hover', isHovered: true })
    if (event.type === 'leave') surface.post({ type: 'hover', isHovered: false })
    if (event.button !== 'left') return
    if (event.type === 'down') isPressed = true
    if (event.type !== 'up' || !isPressed) return
    isPressed = false
    const isInside = event.x >= 0 && event.y >= 0 && event.x < surface.columns && event.y < surface.rows
    if (isInside) surface.post({ type: 'open' })
  })

  const { Text } = surface.elements
  return <Text> </Text>
}

export default ClickArea
