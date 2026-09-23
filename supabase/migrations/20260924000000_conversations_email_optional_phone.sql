-- Permite leads sem telefone (só email) virarem conversas no funil —
-- caso do Extrator quando o Google Maps não tem telefone do negócio.
ALTER TABLE public.conversations
  ALTER COLUMN contact_phone DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS contact_email text;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_user_id_contact_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_phone_uidx
  ON public.conversations (user_id, contact_phone) WHERE contact_phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_email_uidx
  ON public.conversations (user_id, contact_email) WHERE contact_email IS NOT NULL;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_contact_identifier_chk
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL);
