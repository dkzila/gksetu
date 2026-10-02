'use client'

/**
 * TEMPORARY CONSOLE-S1-B verification probe — DELETE AFTER USE.
 * Renders the three pages this agent owns in isolation (the console shell is
 * currently blocked by another agent's in-flight exam-page refactor).
 */
import { useState } from 'react'

import { PostsPage } from '@/components/console/pages/posts-page'
import { SourcesPage } from '@/components/console/pages/sources-page'
import { EntitiesPage } from '@/components/console/pages/entities-page'

export default function S1bProbe() {
  const [tab, setTab] = useState<'posts' | 'sources' | 'entities'>('posts')
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex gap-2">
        {(['posts', 'sources', 'entities'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-md border px-3 py-1.5 text-sm ${tab === value ? 'border-emerald-300 bg-emerald-50 font-medium text-emerald-700' : 'border-zinc-200 bg-white text-zinc-600'}`}
          >
            {value}
          </button>
        ))}
      </div>
      {tab === 'posts' && <PostsPage />}
      {tab === 'sources' && <SourcesPage />}
      {tab === 'entities' && <EntitiesPage />}
    </main>
  )
}
