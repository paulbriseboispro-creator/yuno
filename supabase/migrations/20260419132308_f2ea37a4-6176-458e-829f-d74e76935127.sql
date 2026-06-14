-- Add 'public_event' to event_kind enum and migrate existing organizer_event values
ALTER TYPE public.event_kind ADD VALUE IF NOT EXISTS 'public_event';
