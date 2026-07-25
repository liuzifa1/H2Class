export type AgentEnv = {
  Bindings: {
    AGENT_DB: D1Database;
    AGENT_DISABLED?: string;
    CORE_API_URL: string;
    CORE_API_TOKEN?: string;
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL: string;
    OPENAI_MODEL?: string;
  };
};
