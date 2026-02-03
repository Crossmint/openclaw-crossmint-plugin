// Hardcoded configuration - no user config needed
export const DELEGATION_URL = "https://www.lobster.cash/";
export const ENVIRONMENT = "staging" as const;

export type CrossmintPluginConfig = Record<string, never>;

export const crossmintConfigSchema = {
  parse(_value: unknown): CrossmintPluginConfig {
    return {};
  },
};
