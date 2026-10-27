'use client'

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface InfoHelpProps {
  body: ReactNode
  title: string
}

export function InfoHelp({ body, title }: InfoHelpProps) {
  const [isOpen, setIsOpen] = useState(false)
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
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <>
      <button
        aria-label={`More info about ${title}`}
        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[#9d7248]/60 bg-[#17110d] text-[10px] font-semibold text-[#f2d6ab] transition hover:bg-[#231914] hover:text-[#fff3df]"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        i
      </button>

      {isOpen && isMounted
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-[2147483647] flex items-end justify-center bg-black/65 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 backdrop-blur-[2px] sm:items-center"
              role="dialog"
              onClick={() => setIsOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-[22px] border border-[#a8744a]/55 bg-[linear-gradient(180deg,#261c15_0%,#140f0b_100%)] p-5 shadow-[0_24px_48px_rgba(0,0,0,0.6)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 id={titleId} className="dashboard-gold-title text-[17px] font-semibold">
                    {title}
                  </h3>
                  <button
                    aria-label="Close help"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#b0947a] transition hover:bg-[#2a1f17] hover:text-[#f3e4cf]"
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-[#d9c3a6]">
                  {typeof body === 'string' ? (
                    <p className="whitespace-pre-line">{body}</p>
                  ) : (
                    body
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
