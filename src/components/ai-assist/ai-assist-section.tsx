'use client'

/**
 * GlobIQ — AI assist section (P10-S4)
 *
 * The §26 assist console: classification (rank taxonomy nodes for a draft),
 * exam mapping (rank syllabus nodes for a unit), dedup (near-duplicate unit
 * detection). Suggestions only — the §26 contract line rides every response;
 * nothing is auto-applied.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bot, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface SuggestionBase {
  slug: string
  path: string
  reason: string
}

interface ClassifyResult {
  suggestions: SuggestionBase[]
  candidateCount: number
  contract: string
}

interface MapResult {
  suggestions: Array<SuggestionBase & { depthHint: string }>
  candidateCount: number
  unit: { slug: string; title: string }
  contract: string
}

interface DedupResult {
  verdicts: Array<{ slug: string; title: string; similarity: number; isLikelyDuplicate: boolean; reason: string }>
  candidateCount: number
  contract: string
}

export function AiAssistSection() {
  const { token, user } = useAuth()
  const { toast } = useToast()
  const isStaff = !!token && !!user && user.status === 'ACTIVE' && user.role !== 'READER'

  const [title, setTitle] = useState('The veto power of the P5 in the Security Council')
  const [body, setBody] = useState('Any one of the five permanent members can block a substantive resolution. Reform debates continue through the IGN process.')
  const [unitSlug, setUnitSlug] = useState('un-security-council-permanent-members')
  const [examRef, setExamRef] = useState('upsc-civil-services')
  const [busy, setBusy] = useState<string | null>(null)
  const [classify, setClassify] = useState<ClassifyResult | null>(null)
  const [mapping, setMapping] = useState<MapResult | null>(null)
  const [dedup, setDedup] = useState<DedupResult | null>(null)

  const call = useCallback(
    async (task: 'classify' | 'map' | 'dedup') => {
      if (!token || busy) return
      setBusy(task)
      try {
        const payload: Record<string, unknown> =
          task === 'map' ? { unitSlug, examRef } : { title, body }
        const response = await fetch(`/api/ai-assist/${task}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const result = (await response.json()) as Envelope<ClassifyResult & MapResult & DedupResult>
        if (result.status !== 'ok' || !result.data) {
          toast({ title: 'The assist failed', description: result.error?.message ?? 'Please retry.', variant: 'destructive' })
          return
        }
        if (task === 'classify') setClassify({ suggestions: result.data.suggestions ?? [], candidateCount: result.data.candidateCount, contract: result.data.contract })
        else if (task === 'map') setMapping({ suggestions: result.data.suggestions ?? [], candidateCount: result.data.candidateCount, unit: result.data.unit, contract: result.data.contract })
        else setDedup({ verdicts: result.data.verdicts ?? [], candidateCount: result.data.candidateCount, contract: result.data.contract })
        toast({ title: 'Suggestions ready', description: 'Review them below — nothing was applied (§26).' })
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setBusy(null)
      }
    },
    [token, busy, title, body, unitSlug, examRef, toast]
  )

  useEffect(() => {
    setClassify(null)
    setMapping(null)
    setDedup(null)
  }, [user?.id])

  if (!isStaff) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" aria-hidden />
            AI assist — classification · mapping · dedup (P10-S4)
          </CardTitle>
          <CardDescription>The §26 editorial assist surface.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600">
            AI assists are the editorial surface (§26/§38) — sign in with a staff account to request classification,
            mapping or dedup suggestions. Every result is a suggestion with reasons; nothing is ever auto-applied.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4" aria-hidden />
          AI assist — classification · mapping · dedup (P10-S4)
        </CardTitle>
        <CardDescription>
          §26: AI assists but never becomes the source of truth — suggestions over the platform&apos;s own records
          (the live taxonomy, the exam&apos;s current syllabus, the existing units), human-gated by design.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="classify">
          <TabsList className="flex-wrap">
            <TabsTrigger value="classify">Classify</TabsTrigger>
            <TabsTrigger value="map">Exam mapping</TabsTrigger>
            <TabsTrigger value="dedup">Dedup</TabsTrigger>
          </TabsList>

          <TabsContent value="classify" className="space-y-3 pt-3">
            <div className="grid gap-2">
              <div>
                <Label htmlFor="ai-title">Draft title</Label>
                <Input id="ai-title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ai-body">Draft body (excerpt)</Label>
                <Textarea id="ai-body" value={body} onChange={(event) => setBody(event.target.value)} rows={3} className="mt-1" />
              </div>
            </div>
            <Button onClick={() => void call('classify')} disabled={busy !== null}>
              {busy === 'classify' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Suggest topic nodes
            </Button>
            {classify && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">{classify.suggestions.length} suggestion(s) over {classify.candidateCount} taxonomy nodes:</p>
                {classify.suggestions.map((suggestion) => (
                  <div key={suggestion.slug} className="rounded border border-zinc-200 bg-white p-2">
                    <p className="text-sm font-medium text-zinc-800">{suggestion.path}</p>
                    <p className="text-xs text-zinc-600">{suggestion.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="map" className="space-y-3 pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-unit">Unit slug</Label>
                <Input id="ai-unit" value={unitSlug} onChange={(event) => setUnitSlug(event.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ai-exam">Exam</Label>
                <Input id="ai-exam" value={examRef} onChange={(event) => setExamRef(event.target.value)} className="mt-1" />
              </div>
            </div>
            <Button onClick={() => void call('map')} disabled={busy !== null}>
              {busy === 'map' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Suggest syllabus nodes
            </Button>
            {mapping && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  {mapping.suggestions.length} suggestion(s) for {mapping.unit.title} over {mapping.candidateCount} syllabus nodes:
                </p>
                {mapping.suggestions.map((suggestion) => (
                  <div key={suggestion.slug} className="rounded border border-zinc-200 bg-white p-2">
                    <p className="text-sm font-medium text-zinc-800">
                      {suggestion.path} <span className="text-xs font-normal text-zinc-500">({suggestion.depthHint})</span>
                    </p>
                    <p className="text-xs text-zinc-600">{suggestion.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="dedup" className="space-y-3 pt-3">
            <div className="grid gap-2">
              <div>
                <Label htmlFor="ai-dedup-title">Proposed unit title</Label>
                <Input id="ai-dedup-title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" />
              </div>
            </div>
            <Button onClick={() => void call('dedup')} disabled={busy !== null}>
              {busy === 'dedup' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Check for near-duplicates
            </Button>
            {dedup && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">{dedup.verdicts.length} verdict(s) over {dedup.candidateCount} nearest units:</p>
                {dedup.verdicts.map((verdict) => (
                  <div key={verdict.slug} className={`rounded border p-2 ${verdict.isLikelyDuplicate ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 bg-white'}`}>
                    <p className="text-sm font-medium text-zinc-800">
                      {verdict.title} <span className="text-xs font-normal text-zinc-500">(similarity {verdict.similarity})</span>
                      {verdict.isLikelyDuplicate && <span className="ml-2 text-xs font-semibold text-amber-700">likely duplicate</span>}
                    </p>
                    <p className="text-xs text-zinc-600">{verdict.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <p className="mt-4 flex items-start gap-1.5 text-xs text-zinc-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {(classify ?? mapping ?? dedup)?.contract ??
            '§26: AI assists but never becomes the source of truth — suggestions only, never applied; an editor accepts, edits or rejects them through the normal workflow.'}
        </p>
      </CardContent>
    </Card>
  )
}
