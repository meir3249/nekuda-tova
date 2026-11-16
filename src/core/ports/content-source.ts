/** Provides the raw text of the content file. Validation is core's job, not the source's. */
export interface ContentSource {
  loadRaw(): Promise<string>
}
