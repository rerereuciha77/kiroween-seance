import { loadRegistry } from '@/lib/registry'
import { Source } from '@/types'

export default function HomePage() {
  const sources: Source[] = loadRegistry()
  
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">SÉANCE - Selective Archive of Electronic News and Archives</h1>
      <p className="mb-6">Select a source to browse:</p>
      <div className="grid gap-4">
        {sources.map((source) => (
          <a
            key={source.id}
            href={`/browse/${source.protocol}/${source.host}`}
            className="block p-4 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 bg-gray-200 rounded text-sm font-medium uppercase">
                {source.protocol}
              </span>
              <span className="font-medium">{source.host}:{source.port}</span>
            </div>
            <p className="text-gray-600 mt-1">{source.description}</p>
          </a>
        ))}
      </div>
    </main>
  )
}
