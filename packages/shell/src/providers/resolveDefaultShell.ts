/**
 * Resolve the default shell for input-box `!` commands.
 *
 * Resolution order (docs/design/ps-shell-selection.md §4.2):
 *   settings.defaultShell → 'bash'
 *
 * Platform default is 'bash' everywhere — we do NOT auto-flip Windows to
 * PowerShell (would break existing Windows users with bash hooks).
 */

type SettingsLike = { defaultShell?: 'bash' | 'powershell' }

let _getSettings: () => SettingsLike = () => ({})

/**
 * 设置获取 settings 的函数。由 src/ 桥接层在启动时调用。
 */
export function setGetSettingsFn(fn: () => SettingsLike): void {
  _getSettings = fn
}

export function resolveDefaultShell(): 'bash' | 'powershell' {
  return _getSettings().defaultShell ?? 'bash'
}
