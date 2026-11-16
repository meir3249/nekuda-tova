// Build-time rendering of src/pwa/index.html: fills text from src/pwa/strings.ts, pre-renders the 48
// time options (so the first paint is complete without JavaScript), and adds the Content-Security-Policy.
import { SLOTS } from '../src/core/scheduling/slots.ts'
import { strings } from '../src/pwa/strings.ts'

export interface RenderHtmlOptions {
  /** Extra origins the page may connect to (the Supabase project). `null` = no CSP (dev server, which needs inline HMR). */
  connectOrigins: readonly string[] | null
  /** Link to the privacy note, shown quietly at the end of "How it works"; omitted when empty. */
  privacyUrl: string
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Origin of a URL, or null if it is not an absolute http(s) URL. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

export function contentSecurityPolicy(connectOrigins: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${connectOrigins.join(' ')}`.trim(),
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function renderIndexHtml(template: string, opts: RenderHtmlOptions): string {
  let html = template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = (strings as Record<string, unknown>)[key]
    if (typeof value !== 'string') throw new Error(`index.html uses unknown string key "${key}"`)
    return escapeHtml(value)
  })

  const options = SLOTS.map((s) => `<option value="${s}"${s === '09:00' ? ' selected' : ''}>${s}</option>`).join('')
  // The last paragraph (what is stored) is fine print; the privacy link, when configured, closes the section.
  const how = strings.howItWorks
    .map((p, i, all) => `<p${i === all.length - 1 ? ' class="fine"' : ''}>${escapeHtml(p)}</p>`)
    .join('\n          ')
  const privacy = opts.privacyUrl
    ? `<p class="privacy"><a href="${escapeHtml(opts.privacyUrl)}" rel="noopener noreferrer">${escapeHtml(strings.privacyLink)}</a></p>`
    : ''
  const csp =
    opts.connectOrigins === null
      ? ''
      : `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(opts.connectOrigins))}" />`

  for (const [marker, value] of [
    ['<!--NTK:SLOT_OPTIONS-->', options],
    ['<!--NTK:HOW_IT_WORKS-->', how],
    ['<!--NTK:PRIVACY-->', privacy],
    ['<!--NTK:CSP-->', csp],
  ] as const) {
    if (!html.includes(marker)) throw new Error(`index.html is missing ${marker}`)
    html = html.replace(marker, value)
  }
  return html
}
