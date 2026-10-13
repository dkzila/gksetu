'use client'

/**
 * SITE-S26: Import Translations page — upload a translated JSON file
 * and seed it into the DB.
 *
 * Console route: /console/import-translations
 */
import { useState, useRef } from 'react'
import { Upload, FileJson, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
]

interface ImportResult {
  success: boolean
  language: string
  total: number
  created: number
  skipped: number
  errors: number
}

export function ImportTranslationsPage() {
  const [file, setFile] = useState<File | null>(null)
  const [lang, setLang] = useState<string>('en')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('lang', lang)

      const res = await fetch('/api/import-translations', {
        method: 'POST',
        body: formData,
      })

      // Safely parse response
      let data: ImportResult & { error?: string }
      try {
        data = await res.json()
      } catch {
        setError(`Server returned status ${res.status}. Please try again.`)
        return
      }

      if (!res.ok) {
        setError(data.error || `Upload failed (status ${res.status})`)
      } else {
        setResult(data)
      }
    } catch {
      setError('Network error — please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Translations</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload a translated JSON file to seed MCQs into the database. Topic and Language are auto-assigned.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-emerald-600" />
            Upload Translated File
          </CardTitle>
          <CardDescription>
            Select the target language and upload the JSON file with translated MCQs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Language selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Language</label>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name} ({l.native})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">JSON File</label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-zinc-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-medium
                  file:bg-emerald-50 file:text-emerald-700
                  hover:file:bg-emerald-100
                  cursor-pointer"
              />
            </div>
            {file && (
              <p className="text-xs text-zinc-500">
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {/* Upload button */}
          <Button
            onClick={handleUpload}
            disabled={!file || loading}
            className="w-full gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload &amp; Seed
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-emerald-800">Import Successful!</p>
                <div className="text-sm text-emerald-700 space-y-0.5">
                  <p>Language: <strong>{result.language}</strong></p>
                  <p>Total MCQs in file: <strong>{result.total}</strong></p>
                  <p>Questions created: <strong className="text-emerald-800">{result.created}</strong></p>
                  <p>Skipped (already present): <strong>{result.skipped}</strong></p>
                  {result.errors > 0 && <p>Errors: <strong className="text-red-600">{result.errors}</strong></p>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">Import Failed</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">File Format</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-zinc-50 rounded-lg p-4 overflow-auto">
{`{
  "format": "gksetu-mcq-translations",
  "sourceLanguage": "hi",
  "targetLanguage": "en",
  "mcqs": [
    {
      "id": "geography-gk::...",
      "question": "Translated question text...",
      "optionA": "Translated option A",
      "optionB": "Translated option B",
      "optionC": "Translated option C",
      "optionD": "Translated option D",
      "correctAnswer": "C",
      "subjectSlug": "india-gk",
      "topicSlug": "india-gk"
    }
  ]
}`}
          </pre>
          <p className="text-xs text-zinc-500 mt-2">
            Translate only <code>question</code>, <code>optionA</code>, <code>optionB</code>, <code>optionC</code>, <code>optionD</code>.
            Keep <code>id</code>, <code>correctAnswer</code>, <code>subjectSlug</code>, <code>topicSlug</code> unchanged.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
