import { app } from "electron";
import fs from "fs";
import path from "path";
import type { KeyboardShortcuts } from "../shared/types";

export interface AppConfig {
  lastRoot?: string;
  playlistVisible?: boolean;
  keyboardShortcuts?: Partial<KeyboardShortcuts>;
}

const configFile = () => path.join(app.getPath("userData"), "config.json");

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: AppConfig) {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch {
    // ignore write errors
  }
}
