import { createContext, useContext } from "react";
import { useAgentConfigSettings, type AgentConfigSettings } from "@/hooks/useAgentConfigSettings";

const AgentConfigContext = createContext<AgentConfigSettings | null>(null);

export function AgentConfigProvider({ children }: { children: React.ReactNode }) {
  const value = useAgentConfigSettings();
  return <AgentConfigContext.Provider value={value}>{children}</AgentConfigContext.Provider>;
}

export function useAgentConfig() {
  const ctx = useContext(AgentConfigContext);
  if (!ctx) throw new Error("useAgentConfig must be used within AgentConfigProvider");
  return ctx;
}
