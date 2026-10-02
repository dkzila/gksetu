/**
 * GKSetu — Site Settings module (CONSOLE-S1).
 * The no-redeploy settings registry: public injection payload + admin CRUD.
 */
export {
  PUBLIC_SETTING_KEYS,
  KNOWN_SETTING_KEYS,
  SETTING_KEY_LABELS,
  SettingsError,
  getPublicSettings,
  getPublicSettingValue,
  listSettings,
  upsertSettings,
  removeSetting,
  type PublicSettings,
  type AdminSettingRow,
  type AdminSettingsView,
} from './service'
export {
  settingsUpsertSchema,
  settingsRemoveSchema,
  type SettingsUpsertInput,
  type SettingsRemoveInput,
} from './validation'
