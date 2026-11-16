import type { KeyValueStore } from '../state/local-cache.ts'

/** Set when the sheet has been shown automatically once. Never displayed, never counted. */
export const INSTALL_HINT_SEEN_KEY = 'ntk.installHintSeen'
/** The sheet rises a moment after first paint, so the screen is seen first. */
export const INSTALL_SHEET_DELAY_MS = 700
/** Matches the fade-out in styles.css; the element is hidden afterwards. */
export const INSTALL_SHEET_CLOSE_MS = 250

export const INSTALL_SHEET_IDS = { sheet: 'install-sheet', dismiss: 'install-dismiss' } as const

export interface InstallSheet {
  open(): void
  close(): void
  isOpen(): boolean
  /** Opens once, after first paint, if it has never been shown automatically before. */
  showFirstTimeOnly(): void
}

export interface InstallSheetDeps {
  doc: Document
  store: KeyValueStore
  /** Where focus returns on close (the notifications switch). */
  returnFocusTo: HTMLElement
  /** Called on open, so nothing else (the toast) is visible at the same time. */
  onOpen(): void
}

function seen(store: KeyValueStore): boolean {
  try {
    return store.getItem(INSTALL_HINT_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen(store: KeyValueStore): void {
  try {
    store.setItem(INSTALL_HINT_SEEN_KEY, '1')
  } catch {
    /* storage unavailable: at worst the hint shows again next visit */
  }
}

/**
 * The one soft, dismissible iOS install hint (spec 07). Non-modal: no backdrop, the settings stay usable above it.
 * Dismissed by "Not now" or Esc; focus moves in on open and back to the switch on close.
 */
export function createInstallSheet(deps: InstallSheetDeps): InstallSheet {
  const { doc } = deps
  const sheet = doc.getElementById(INSTALL_SHEET_IDS.sheet)
  const dismiss = doc.getElementById(INSTALL_SHEET_IDS.dismiss)
  if (!sheet || !dismiss) throw new Error('Missing install sheet markup')

  let openNow = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const onKey = (e: Event): void => {
    if ((e as KeyboardEvent).key === 'Escape') api.close()
  }

  const api: InstallSheet = {
    open() {
      if (hideTimer !== null) clearTimeout(hideTimer)
      hideTimer = null
      markSeen(deps.store)
      deps.onOpen()
      sheet.hidden = false
      sheet.classList.add('open')
      if (!openNow) doc.addEventListener('keydown', onKey)
      openNow = true
      sheet.focus()
    },
    close() {
      if (!openNow) return
      openNow = false
      doc.removeEventListener('keydown', onKey)
      sheet.classList.remove('open')
      hideTimer = setTimeout(() => {
        hideTimer = null
        sheet.hidden = true
      }, INSTALL_SHEET_CLOSE_MS)
      deps.returnFocusTo.focus()
    },
    isOpen: () => openNow,
    showFirstTimeOnly() {
      if (seen(deps.store)) return
      setTimeout(() => {
        if (!openNow && !seen(deps.store)) api.open()
      }, INSTALL_SHEET_DELAY_MS)
    },
  }

  dismiss.addEventListener('click', () => api.close())
  return api
}
