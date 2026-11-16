export const SAVED_VISIBLE_MS = 2000
/** Gentle notices (couldn't save, coming soon) stay longer, then the toast floats away; retries continue silently. */
export const NOTICE_VISIBLE_MS = 6000

export interface StatusLine {
  /** Shows a message until replaced or cleared. */
  show(text: string): void
  /** Shows a message, then clears it after `ms` (unless something else replaced it). */
  flash(text: string, ms?: number): void
  clear(): void
  current(): string
}

/**
 * The single polite live region. Visibility is a CSS class (opacity fade, disabled under
 * `prefers-reduced-motion` in the stylesheet); the text itself is what screen readers announce.
 */
export function createStatusLine(el: HTMLElement): StatusLine {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const set = (text: string): void => {
    el.textContent = text
    el.classList.toggle('visible', text !== '')
  }
  return {
    show(text) {
      cancel()
      set(text)
    },
    flash(text, ms = SAVED_VISIBLE_MS) {
      cancel()
      set(text)
      timer = setTimeout(() => {
        timer = null
        set('')
      }, ms)
    },
    clear() {
      cancel()
      set('')
    },
    current() {
      return el.textContent ?? ''
    },
  }
}
