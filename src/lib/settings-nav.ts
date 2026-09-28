import type { LucideIcon } from "lucide-react";
import { Bot, Building2, BookOpen, CircleSlash, Smartphone } from "lucide-react";

export type SettingsNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
};

export type SettingsNavGroup = {
  title: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    title: "Canais",
    items: [
      {
        to: "/configuracoes/whatsapp",
        label: "WhatsApp",
        icon: Smartphone,
        description: "Servidor Uazapi, tokens, webhook e QR Code.",
      },
    ],
  },
  {
    title: "IA",
    items: [
      {
        to: "/configuracoes/negocio",
        label: "Seu negócio",
        icon: Building2,
        description: "Contexto da empresa para o modo novo da Edith.",
      },
      {
        to: "/configuracoes/agente",
        label: "Agente Groq",
        icon: Bot,
        description: "Chave, prompt, follow-up automático e ativação.",
      },
      {
        to: "/configuracoes/conhecimento",
        label: "Base de conhecimento",
        icon: BookOpen,
        description: "Tópicos que a IA consulta nas respostas.",
      },
    ],
  },
  {
    title: "CRM",
    items: [
      {
        to: "/configuracoes/crm",
        label: "Motivos de perda",
        icon: CircleSlash,
        description: "Lista usada ao mover leads para Perdido.",
      },
    ],
  },
];
