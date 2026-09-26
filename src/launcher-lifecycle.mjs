// A duplicate launch may only ask the live supervisor to wake its app.
// In particular, a closing supervisor must never cause a plain EXE launch.
export function duplicateAction(owner, state, ownerAlive) {
  if (!ownerAlive) return 'acquire';
  if (state?.pid !== owner?.pid || !state?.active) return 'wait';
  if (state.phase === 'waiting-for-app-exit') return 'waiting-for-app-exit';
  if (state.phase === 'ready') return 'request-wake';
  return 'wait';
}

export function appLaunchOptions(port, environment = process.env) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效汉化端口');
  return {
    detached: true, stdio: 'ignore', windowsHide: false,
    env: { ...environment, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` }
  };
}

export function overlayNeedsRepair(status) {
  return !status || status.enabled === false;
}

// An absent app needs no reconnection grace. Unknown/running processes still
// receive the full grace period, and we never terminate them to speed up launch.
export function disconnectShouldStop(appRunning, disconnectedMs) {
  return appRunning === false || disconnectedMs >= 15000;
}
