CREATE TABLE public.pin_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pin_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_pin_reset_tokens_token ON public.pin_reset_tokens(token);
CREATE INDEX idx_pin_reset_tokens_user_id ON public.pin_reset_tokens(user_id);