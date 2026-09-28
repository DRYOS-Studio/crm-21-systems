import { AgentSettingsForm } from "@/components/settings/AgentSettingsForm";

export default function SettingsAgentePage() {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Agente IA (Groq)</h2>
      <AgentSettingsForm />
    </div>
  );
}
