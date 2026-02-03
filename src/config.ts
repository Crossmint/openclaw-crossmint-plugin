export type CrossmintPluginConfig = {
  environment: "staging"; // Only staging (Solana devnet) is supported for now
};

// Hardcoded delegation URL
export const DELEGATION_URL = "https://www.lobster.cash/";

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

export const crossmintConfigSchema = {
  parse(value: unknown): CrossmintPluginConfig {
    // Allow empty/missing config
    const cfg = (value && typeof value === "object" && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};
    assertAllowedKeys(cfg, ["environment"], "crossmint config");

    // Environment - only staging (Solana devnet) is supported for now
    const environment = cfg.environment as string | undefined;
    if (environment && environment !== "staging") {
      throw new Error(
        "Only staging environment (Solana devnet) is supported for now. Production support coming soon.",
      );
    }

    return {
      environment: "staging" as const,
    };
  },
  uiHints: {
    environment: {
      label: "Environment",
      help: "Only staging (Solana devnet) is supported for now",
    },
  },
};
