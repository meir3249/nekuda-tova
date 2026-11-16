// Usage: node scripts/validate-content.ts [path]   (default: data/messages.json)
// Exit codes: 0 valid, 1 invalid, 2 usage error or unreadable file.
import { appendFileSync } from 'node:fs'
import { ContentReadError, RepoFileContentSource } from '../src/adapters/repo-file/repo-file-content-source.ts'
import { validateContent } from '../src/core/content/index.ts'
import type { ValidationIssue } from '../src/core/content/index.ts'

function print(label: string, issues: readonly ValidationIssue[]): void {
  for (const i of issues) console.log(`${label} ${i.code} ${i.path || '(file)'}: ${i.message}`)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.length > 1 || args[0] === '--help' || args[0] === '-h') {
    console.error('Usage: node scripts/validate-content.ts [path]')
    return 2
  }
  const filePath = args[0] ?? 'data/messages.json'

  let raw: string
  try {
    raw = await new RepoFileContentSource(filePath).loadRaw()
  } catch (e) {
    if (e instanceof ContentReadError) {
      console.error(`ERROR ${e.reason === 'invalid_utf8' ? 'INVALID_JSON' : 'READ_ERROR'}: ${e.message}`)
      return e.reason === 'invalid_utf8' ? 1 : 2
    }
    throw e
  }

  const result = validateContent(raw)
  print('WARN ', result.warnings)
  if (!result.ok) {
    print('ERROR', result.errors)
    console.error(`${filePath}: INVALID (${result.errors.length} error(s))`)
    return 1
  }
  console.log(`${filePath}: OK (${result.content.messages.length} messages, ${result.warnings.length} warning(s))`)
  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) {
    appendFileSync(summary, `### Content validation\n\n\`${filePath}\`: OK, ${result.content.messages.length} messages.\n`)
  }
  return 0
}

process.exitCode = await main()
