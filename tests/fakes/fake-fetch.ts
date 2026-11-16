export interface RecordedRequest {
  url: URL
  method: string
  headers: Headers
  body: unknown
}

export type FakeReply = { status?: number; body?: unknown } | Error

/** Minimal fetch fake: records requests, replies from a queue (or a function). */
export class FakeFetch {
  readonly requests: RecordedRequest[] = []
  private readonly queue: FakeReply[] = []
  private readonly fallback: ((r: RecordedRequest) => FakeReply) | null

  constructor(fallback: ((r: RecordedRequest) => FakeReply) | null = null) {
    this.fallback = fallback
  }

  reply(...replies: FakeReply[]): this {
    this.queue.push(...replies)
    return this
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const text = await req.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const recorded: RecordedRequest = { url: new URL(req.url), method: req.method, headers: req.headers, body }
    this.requests.push(recorded)
    const reply = this.queue.shift() ?? this.fallback?.(recorded) ?? { status: 200, body: null }
    if (reply instanceof Error) throw reply
    const status = reply.status ?? 200
    const hasBody = reply.body !== undefined && status !== 204
    return new Response(hasBody ? JSON.stringify(reply.body) : null, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
