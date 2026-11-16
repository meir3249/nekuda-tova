/** Source of the current time. Core never reads the system clock directly. */
export interface Clock {
  now(): Date
}
