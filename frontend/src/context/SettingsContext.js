import { createContext } from "react";
import { DEFAULT_SETTINGS } from "../config/campusConfig.js";

export const SettingsContext = createContext({ cfg: DEFAULT_SETTINGS, updateCfg: () => {} });
