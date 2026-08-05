import type { PersistedState } from "../types";

export const DEFAULT_STATE: PersistedState = {
  settings: {
    proxyUrl: "socks://127.0.0.1:7890",
    tunEnabled: false,
    theme: "system",
    accentColor: "blue",
    launchAtLogin: false,
    startMinimized: true,
    bypassLan: true,
    additionalBypassCidrs: [],
    exitBehavior: "restore_direct",
  },
  rules: [],
};
