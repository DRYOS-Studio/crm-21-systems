-- Toque 1 precisa caber uma conversa de WhatsApp, não um telegrama de 120.
alter table public.outreach_openers drop constraint if exists outreach_openers_len_chk;
alter table public.outreach_openers
  add constraint outreach_openers_len_chk
  check (char_length(text) <= 280 and char_length(btrim(text)) > 0);
