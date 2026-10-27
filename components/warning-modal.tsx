'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

interface WarningModalAction {
  label: string
  onClick: () => void
  tone?: 'danger' | 'neutral'
}

interface WarningModalProps {
  // Extra choices shown before the secondary action, e.g. a destructive option.
  extraActions?: WarningModalAction[]
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
  extraActions = [],
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
      className="fixed inset-0 z-[2147483647] flex items-end justify-center bg-black/65 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-[22px] border border-[#a8744a]/55 bg-[linear-gradient(180deg,#261c15_0%,#140f0b_100%)] p-5 shadow-[0_0_28px_rgba(224,162,90,0.14),0_24px_48px_rgba(0,0,0,0.6)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffcf6e]">
              Heads up
            </p>
            <h3 id={titleId} className="dashboard-gold-title mt-2 text-[17px] font-semibold">
              {title}
            </h3>
          </div>
          <button
            aria-label="Close warning"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#b0947a] transition hover:bg-[#2a1f17] hover:text-[#f3e4cf]"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#d9c3a6]">{body}</p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {extraActions.map((action) => (
            <button
              key={action.label}
              className={
                action.tone === 'danger'
                  ? 'rounded-[13px] border border-[#ff6b5b]/60 bg-[#2a0f0c] px-4 py-2.5 text-sm font-semibold text-[#ffd9d2] transition hover:bg-[#3a1410]'
                  : 'rounded-[13px] border border-[#a97849]/60 bg-[#1a1410] px-4 py-2.5 text-sm font-semibold text-[#e8cfae] transition hover:bg-[#241a14]'
              }
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
          {secondaryActionLabel ? (
            <button
              className="rounded-[13px] border border-[#a97849]/60 bg-[#1a1410] px-4 py-2.5 text-sm font-semibold text-[#e8cfae] transition hover:bg-[#241a14]"
              onClick={onSecondaryAction ?? onClose}
              type="button"
            >
              {secondaryActionLabel}
            </button>
          ) : null}
          <button
            className="rounded-[13px] border border-[#fff1c4]/70 bg-[linear-gradient(180deg,#ffe9a8_0%,#f2b860_45%,#c27a3a_100%)] px-4 py-2.5 text-sm font-semibold text-[#1b0f05] shadow-[0_0_12px_rgba(255,190,90,0.3)] transition hover:brightness-105"
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
