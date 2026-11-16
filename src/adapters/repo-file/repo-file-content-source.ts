import { readFile } from 'node:fs/promises'
import type { ContentSource } from '../../core/ports/content-source.ts'

export class ContentReadError extends Error {
  readonly reason: 'not_found' | 'invalid_utf8' | 'unreadable'

  constructor(reason: ContentReadError['reason'], message: string) {
    super(message)
    this.name = 'ContentReadError'
    this.reason = reason
  }
}

/** Reads the content file from disk (the repo checkout). Strict UTF-8: invalid bytes are an error. */
export class RepoFileContentSource implements ContentSource {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async loadRaw(): Promise<string> {
    let bytes: Uint8Array
    try {
      bytes = await readFile(this.filePath)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'ENOENT') throw new ContentReadError('not_found', `File not found: ${this.filePath}`)
      throw new ContentReadError('unreadable', `Cannot read ${this.filePath}: ${(e as Error).message}`)
    }
    try {
      // ignoreBOM: keep a BOM in the text so the validator can strip it explicitly.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      throw new ContentReadError('invalid_utf8', `${this.filePath} is not valid UTF-8.`)
    }
  }
}
