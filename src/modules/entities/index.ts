/**
 * GKSetu — Entities module (P6-S3)
 * Master Plan §6 (Entity row), §12 step 3 (event-entity linking), §13, §14,
 * §17, §36, §37, §38. The registry behind current-affairs entity linking:
 * persons/places/organisations/concepts as canonical reference records with
 * aliases and §14 country scoping. Event LINKS live in the current-affairs
 * service (they are event operations); this module owns the records.
 */
export * from './types'
export * from './validation'
export * from './service'
