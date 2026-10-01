alter table public.q7_installations
  add column if not exists whatsapp_managed_mode boolean not null default true,
  add column if not exists whatsapp_extra_qr_count integer not null default 0
    check (whatsapp_extra_qr_count >= 0),
  add column if not exists whatsapp_secrets_configured boolean not null default false;
