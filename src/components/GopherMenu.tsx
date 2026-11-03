import Link from 'next/link'
import { NormalisedRecord } from '@/types'

interface Props {
  records: NormalisedRecord[]
  protocol: string
  host: string
  port: number
}

const GLYPH: Record<string, string> = {
  menu: '›',
  text: '≡',
  search: '?',
  info: '·',
  group: '#',
  article: '§',
  finger: '☏',
}

/**
 * Gopher menu / group listing as navigable links; informational lines stay
 * inert so a menu looks like the terminal it came from.
 */
export default function GopherMenu({ records, protocol, host, port }: Props) {
  if (records.length === 0) {
    return <p className="empty">no records returned by this selector.</p>
  }

  return (
    <div className="records">
      {records.map((record, i) => {
        const glyph = GLYPH[record.kind] ?? '·'
        const label = record.label?.trim() || record.selector || '(untitled)'

        if (record.kind === 'info' || !record.selector) {
          return (
            <div key={`${record.selector}-${i}`} className="record record-info">
              <span className="glyph">{glyph}</span>
              {label}
            </div>
          )
        }

        const href = `/browse/${protocol}/${host}?port=${port}&s=${encodeURIComponent(record.selector)}`
        return (
          <Link key={`${record.selector}-${i}`} href={href} className="record">
            <span className="glyph">{glyph}</span>
            {label}
            {record.bytes > 0 ? <span className="record-meta">{record.bytes} B</span> : null}
          </Link>
        )
      })}
    </div>
  )
}