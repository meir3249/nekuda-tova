import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export interface Violation {
  file: string
  specifier: string
  rule: string
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/

function listSourceFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listSourceFiles(full))
    else if (SOURCE_EXT.test(name)) out.push(full)
  }
  return out
}

/** All import/export-from/dynamic import()/require specifiers, including type-only ones. */
export function importSpecifiers(source: string): string[] {
  const info = ts.preProcessFile(source, true, true)
  return info.importedFiles.map((f) => f.fileName)
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function isRelative(spec: string): boolean {
  return spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')
}

/**
 * Rules (spec 01):
 *  1. src/core imports only files inside src/core (no packages, no node:*, no escaping paths).
 *  2. src/adapters/<a> never imports src/adapters/<b>.
 *  3. src/pwa never imports src/sender or src/adapters/web-push.
 */
export function findViolations(srcRoot: string): Violation[] {
  const violations: Violation[] = []
  const coreDir = path.join(srcRoot, 'core')
  const adaptersDir = path.join(srcRoot, 'adapters')
  const pwaDir = path.join(srcRoot, 'pwa')
  const senderDir = path.join(srcRoot, 'sender')
  const webPushDir = path.join(adaptersDir, 'web-push')

  for (const file of listSourceFiles(coreDir)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!isRelative(spec)) {
        violations.push({ file, specifier: spec, rule: 'core-no-external-imports' })
        continue
      }
      const target = path.resolve(path.dirname(file), spec)
      if (!isInside(coreDir, target)) {
        violations.push({ file, specifier: spec, rule: 'core-no-escaping-imports' })
      }
    }
  }

  for (const file of listSourceFiles(adaptersDir)) {
    const own = path.relative(adaptersDir, file).split(path.sep)[0]
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!isRelative(spec)) continue
      const target = path.resolve(path.dirname(file), spec)
      if (!isInside(adaptersDir, target)) continue
      const other = path.relative(adaptersDir, target).split(path.sep)[0]
      if (other !== own) {
        violations.push({ file, specifier: spec, rule: 'adapters-no-cross-imports' })
      }
    }
  }

  for (const file of listSourceFiles(pwaDir)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!isRelative(spec)) continue
      const target = path.resolve(path.dirname(file), spec)
      if (isInside(senderDir, target) || isInside(webPushDir, target)) {
        violations.push({ file, specifier: spec, rule: 'pwa-no-sender-or-web-push' })
      }
    }
  }

  return violations
}
