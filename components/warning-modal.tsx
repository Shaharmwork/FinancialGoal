'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

interface WarningModalProps {
  body: string
  isOpen: boolean
  onClose: () => void
  primaryActionLabel?: string
  onPrimaryAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  title: string
}

export function WarningModal({
  body,
  isOpen,
  onClose,
  onPrimaryAction,
  onSecondaryAction,
  primaryActionLabel,
  secondaryActionLabel,
  title,
}: WarningModalProps) {
  const [isMounted, setIsMounted] = useState(false)
  const titleId = useId()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen || !isMounted) {
    return null
  }

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[2147483647] flex items-start justify-center bg-foreground/35 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="mt-2 w-full max-w-sm rounded-[1.6rem] border border-border bg-card p-5 shadow-[0_24px_48px_rgba(24,32,48,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Warning
            </p>
            <h3 id={titleId} className="mt-2 text-base font-semibold text-foreground">
              {title}
            </h3>
          </div>
          <button
            aria-label="Close warning"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>

        <div className="mt-5 flex justify-end gap-2">
          {secondaryActionLabel ? (
            <button
              className="rounded-full bg-muted px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/80"
              onClick={onSecondaryAction ?? onClose}
              type="button"
            >
              {secondaryActionLabel}
            </button>
          ) : null}
          <button
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            onClick={onPrimaryAction ?? onClose}
            type="button"
          >
            {primaryActionLabel ?? 'Close'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
