import type { PersistedState } from "../types";

export const DEFAULT_STATE: PersistedState = {
  settings: {
    proxyUrl: "http://127.0.0.1:7890",
    launcherSuffix: "-proxy",
    theme: "system",
    accentColor: "blue",
    launchAtLogin: false,
    startMinimized: true,
  },
  rules: [],
};
