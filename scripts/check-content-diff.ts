// Usage: node scripts/check-content-diff.ts <base.json> <head.json>
// Exit codes: 0 ok (warnings allowed), 1 errors, 2 usage error or head unreadable.
// If the base file does not exist (first commit), the check is skipped with exit 0.
import { appendFileSync } from 'node:fs'
import { ContentReadError, RepoFileContentSource } from '../src/adapters/repo-file/repo-file-content-source.ts'
import { diffContent, validateContent } from '../src/core/content/index.ts'
import type { MessageCollection, ValidationIssue } from '../src/core/content/index.ts'

async function load(path: string, label: string): Promise<MessageCollection | { exit: number }> {
  let raw: string
  try {
    raw = await new RepoFileContentSource(path).loadRaw()
  } catch (e) {
    if (e instanceof ContentReadError) {
      if (label === 'base' && e.reason === 'not_found') {
        console.log('No base content file found (first commit?). Diff check skipped.')
        return { exit: 0 }
      }
      console.error(`ERROR cannot read ${label}: ${e.message}`)
      return { exit: 2 }
    }
    throw e
  }
  const result = validateContent(raw)
  if (!result.ok) {
    console.error(`ERROR the ${label} file is invalid:`)
    for (const i of result.errors) console.error(`  ${i.code} ${i.path || '(file)'}: ${i.message}`)
    return { exit: 1 }
  }
  return result.content
}

function isExit(v: MessageCollection | { exit: number }): v is { exit: number } {
  return 'exit' in v
}

function line(prefix: string, i: ValidationIssue): string {
  return `${prefix} ${i.code} ${i.path}: ${i.message}`
}

async function main(): Promise<number> {
  const [basePath, headPath, ...rest] = process.argv.slice(2)
  if (!basePath || !headPath || rest.length > 0) {
    console.error('Usage: node scripts/check-content-diff.ts <base.json> <head.json>')
    return 2
  }
  const base = await load(basePath, 'base')
  if (isExit(base)) return base.exit
  const head = await load(headPath, 'head')
  if (isExit(head)) return head.exit

  const { errors, warnings } = diffContent(base, head)
  for (const w of warnings) console.log(line('WARN ', w))
  for (const e of errors) console.error(line('ERROR', e))

  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) {
    const body = [
      '### Content change impact',
      '',
      errors.length === 0 && warnings.length === 0 ? 'No impact on existing readers (append-only or no change).' : '',
      ...errors.map((e) => `- **Error** \`${e.code}\` ${e.message}`),
      ...warnings.map((w) => `- Warning \`${w.code}\` ${w.message}`),
      '',
    ].join('\n')
    appendFileSync(summary, body)
  }

  if (errors.length > 0) return 1
  console.log(`Diff check OK (${warnings.length} warning(s)).`)
  return 0
}

process.exitCode = await main()
