import type { LucideIcon } from "lucide-react";
import { Bot, Building2, BookOpen, CircleSlash, CreditCard, Server, Smartphone, Tags, Users } from "lucide-react";

export type SettingsNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  adminOnly?: boolean;
};

export type SettingsNavGroup = {
  title: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    title: "Conta",
    items: [
      {
        to: "/configuracoes/faturamento",
        label: "Faturamento",
        icon: CreditCard,
        description: "Status da assinatura, prazo de regularização e cobranças.",
      },
      {
        to: "/configuracoes/usuarios",
        label: "Usuários",
        icon: Users,
        description: "Convites, módulos e dispositivos por usuário.",
        adminOnly: true,
      },
    ],
  },
  {
    title: "Canais",
    items: [
      {
        to: "/configuracoes/whatsapp",
        label: "WhatsApp",
        icon: Smartphone,
        description: "Servidor Uazapi, tokens, webhook e QR Code.",
        adminOnly: true,
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
        label: "Agente IA",
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
      {
        to: "/configuracoes/campos",
        label: "Campos personalizados",
        icon: Tags,
        description: "Campos adicionais para a ficha do lead.",
      },
      {
        to: "/configuracoes/marca",
        label: "Marca",
        icon: Tags,
        description: "Logo exibida nesta instalação.",
        adminOnly: true,
      },
      {
        to: "/configuracoes/instalacoes",
        label: "Instalações",
        icon: Server,
        description: "Empresas, projetos dedicados, releases e faturamento.",
        adminOnly: true,
      },
    ],
  },
];
