'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

interface InfoHelpProps {
  body: string
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
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        i
      </button>

      {isOpen && isMounted
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-[2147483647] flex items-start justify-center bg-foreground/35 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]"
              role="dialog"
              onClick={() => setIsOpen(false)}
            >
              <div
                className="mt-2 w-full max-w-sm rounded-[1.6rem] border border-border bg-card p-5 shadow-[0_24px_48px_rgba(24,32,48,0.28)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 id={titleId} className="text-base font-semibold text-foreground">
                    {title}
                  </h3>
                  <button
                    aria-label="Close help"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted"
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    <span aria-hidden="true" className="text-lg leading-none">
                      ×
                    </span>
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
