'use client'

import { useState, type ReactNode } from 'react'

interface Props {
  raw: string
  children: ReactNode
}

/**
 * Toggle between the rendered view and the bytes the server actually sent.
 * The raw pane is the evidence: judges and agents can compare it with the
 * MCP tool output for the same selector.
 */
export default function RawToggle({ raw, children }: Props) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div>
      <div className="toolbar">
        <span className="count">{showRaw ? 'raw wire bytes' : 'rendered records'}</span>
        <button type="button" className="button" onClick={() => setShowRaw(v => !v)}>
          {showRaw ? 'render' : 'raw'}
        </button>
      </div>
      {showRaw ? <pre className="body">{raw || '(empty response)'}</pre> : children}
    </div>
  )
}