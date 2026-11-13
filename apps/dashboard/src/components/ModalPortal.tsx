import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  onClose?: () => void
}

let openCount = 0

/**
 * Renders modal content directly under <body> so `position: fixed` is always
 * relative to the viewport. Rendering inside the page meant any ancestor with a
 * `transform` (e.g. the page fade-in animation) became the containing block, so
 * modals centred on the full page height instead of where the user was looking.
 *
 * Also locks background scroll while open and closes on Escape.
 */
export function ModalPortal({ children, onClose }: Props) {
  useEffect(() => {
    openCount += 1
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      openCount -= 1
      if (openCount === 0) body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    if (!onClose) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(children, document.body)
}
