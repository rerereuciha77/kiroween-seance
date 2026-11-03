import Link from 'next/link'

export interface Crumb {
  label: string
  selector: string
}

interface Props {
  protocol: string
  host: string
  port: number
  crumbs: Crumb[]
}

function href(protocol: string, host: string, port: number, selector: string): string {
  return `/browse/${protocol}/${host}?port=${port}&s=${encodeURIComponent(selector)}`
}

/** Breadcrumb trail: every ancestor selector stays navigable. */
export default function Breadcrumb({ protocol, host, port, crumbs }: Props) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link href="/">séance</Link>
      <span className="sep">/</span>
      <Link href={href(protocol, host, port, '')}>
        {protocol}:{host}
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.selector}-${i}`} style={{ display: 'contents' }}>
          <span className="sep">/</span>
          <Link href={href(protocol, host, port, crumb.selector)}>{crumb.label}</Link>
        </span>
      ))}
    </nav>
  )
}