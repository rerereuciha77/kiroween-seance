import Link from 'next/link'
import { NormalisedRecord } from '@/types'

interface Props {
  records: NormalisedRecord[]
  protocol: string
  host: string
  port: number
}

/** Trim an RFC 5322 author down to the display name or address. */
function shortAuthor(from?: string): string {
  if (!from) return 'unknown'
  const named = /^(.*?)<([^>]+)>/.exec(from)
  if (named && named[1]?.trim()) return named[1].trim().replace(/^"|"$/g, '')
  return from.trim()
}

/** Trim an RFC 5322 date to "YYYY-MM-DD hh:mm" when parseable. */
function shortDate(date?: string): string {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date.slice(0, 24)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Usenet article listing: subject / author / date, each row opens the article. */
export default function ArticleList({ records, protocol, host, port }: Props) {
  if (records.length === 0) {
    return <p className="empty">this group returned no recent articles.</p>
  }

  return (
    <table className="articles">
      <thead>
        <tr>
          <th>subject</th>
          <th>from</th>
          <th>date (utc)</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record, i) => {
          const href = `/browse/${protocol}/${host}?port=${port}&s=${encodeURIComponent(record.selector)}`
          const [subject] = record.label.split(' — ')
          return (
            <tr key={`${record.selector}-${i}`}>
              <td>
                <Link href={href}>{subject || '(no subject)'}</Link>
              </td>
              <td>{shortAuthor(record.author)}</td>
              <td>{shortDate(record.date)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}