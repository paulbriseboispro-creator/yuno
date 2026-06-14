-- Add optional WhatsApp number field to venues
ALTER TABLE public.venues
ADD COLUMN whatsapp_number text;