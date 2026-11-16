import type { ContentSource } from '../../src/core/ports/content-source.ts'

/** Content source backed by a string, or failing on demand. */
export class FakeContentSource implements ContentSource {
  private raw: string
  private failure: Error | null = null

  constructor(raw: string) {
    this.raw = raw
  }

  set(raw: string): void {
    this.raw = raw
  }

  failWith(error: Error | null): void {
    this.failure = error
  }

  async loadRaw(): Promise<string> {
    if (this.failure) throw this.failure
    return this.raw
  }
}
