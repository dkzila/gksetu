/**
 * Split untranslated-en.json into 30 smaller files of ~125 MCQs each.
 * Run: bun scripts/s26-split-export.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const INPUT = join(process.cwd(), 'scripts', 's26-export', 'untranslated-en.json')
const OUTPUT_DIR = join(process.cwd(), 'scripts', 's26-export', 'split')

interface MCQ {
  id: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  subjectSlug: string
  topicSlug: string
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const data = JSON.parse(readFileSync(INPUT, 'utf-8'))
  const mcqs: MCQ[] = data.mcqs

  const TOTAL_FILES = 30
  const PER_FILE = Math.ceil(mcqs.length / TOTAL_FILES)

  console.log(`Total MCQs: ${mcqs.length}, splitting into ${TOTAL_FILES} files of ~${PER_FILE} each`)

  for (let i = 0; i < TOTAL_FILES; i++) {
    const start = i * PER_FILE
    const end = Math.min(start + PER_FILE, mcqs.length)
    const chunk = mcqs.slice(start, end)

    const fileNum = String(i + 1).padStart(2, '0')
    const fileName = `untranslated-en-${fileNum}.json`
    const filePath = join(OUTPUT_DIR, fileName)

    writeFileSync(filePath, JSON.stringify({
      format: 'gksetu-mcq-translations',
      sourceLanguage: 'hi',
      targetLanguage: 'en',
      fileNumber: i + 1,
      totalFiles: TOTAL_FILES,
      totalMCQs: chunk.length,
      instructions: 'Translate only question, optionA, optionB, optionC, optionD from Hindi to English. Keep id, correctAnswer, subjectSlug, topicSlug UNCHANGED. Return the same JSON format.',
      mcqs: chunk,
    }, null, 2))

    console.log(`  ${fileName}: ${chunk.length} MCQs`)
  }

  console.log(`\nDone! ${TOTAL_FILES} files written to ${OUTPUT_DIR}/`)
}

main()
