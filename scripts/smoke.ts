import { gopherFetch } from '../src/lib/protocols/gopher'
import { fingerFetch } from '../src/lib/protocols/finger'

async function main() {
  const g = await gopherFetch('gopher.floodgap.com', 70, '/1/')
  if (g.ok) {
    const items = (g as any).items ?? (g as any).records ?? []
    console.log('GOPHER ok:', 'kind=' + ((g as any).kind ?? 'menu'), 'items=' + items.length)
    for (const it of items.slice(0, 5)) console.log('  -', it.kind, it.label, '->', it.selector)
  } else {
    console.log('GOPHER FAILED:', (g as any).error?.message ?? g)
  }

  const f = await fingerFetch('graph.no', 79, '', { timeoutMs: 8000 })
  if (f.ok) {
    const text = String((f as any).text ?? (f as any).body ?? '')
    console.log('FINGER ok: bytes=' + text.length)
    console.log(text.split('\n').slice(0, 4).join('\n'))
  } else {
    console.log('FINGER FAILED:', (f as any).error?.message ?? f)
  }
}

main().catch((e) => {
  console.error('SMOKE ERROR', e)
  process.exit(1)
})