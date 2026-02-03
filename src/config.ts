export type CrossmintPluginConfig = {
  delegationUrl: string;
  environment: "staging"; // Only staging (Solana devnet) is supported for now
};

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

export const crossmintConfigSchema = {
  parse(value: unknown): CrossmintPluginConfig {
    // Allow empty/missing config if env vars are set
    const cfg = (value && typeof value === "object" && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};
    assertAllowedKeys(cfg, ["delegationUrl", "environment"], "crossmint config");

    // Delegation URL - required
    let delegationUrl = cfg.delegationUrl as string | undefined;
    if (!delegationUrl) {
      delegationUrl = process.env.CROSSMINT_DELEGATION_URL;
    }
    if (!delegationUrl) {
      throw new Error(
        "delegationUrl is required. Set it in plugin config or CROSSMINT_DELEGATION_URL env var.",
      );
    }

    // Environment - only staging (Solana devnet) is supported for now
    const environment = cfg.environment as string | undefined;
    if (environment && environment !== "staging") {
      throw new Error(
        "Only staging environment (Solana devnet) is supported for now. Production support coming soon.",
      );
    }

    return {
      delegationUrl: resolveEnvVars(delegationUrl),
      environment: "staging" as const,
    };
  },
  uiHints: {
    delegationUrl: {
      label: "Delegation URL",
      placeholder: "https://your-app.com/delegate",
      help: "URL of the web app where users authorize the agent (or use ${CROSSMINT_DELEGATION_URL})",
    },
    environment: {
      label: "Environment",
      help: "Only staging (Solana devnet) is supported for now",
    },
  },
};
