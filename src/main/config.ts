import { app } from "electron";
import fs from "fs";
import path from "path";

export interface AppConfig {
  lastRoot?: string;
  playlistVisible?: boolean;
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
