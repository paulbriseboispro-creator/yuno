
-- Track which users have received recap for which events
CREATE TABLE IF NOT EXISTS public.event_recap_sent (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Enable RLS
ALTER TABLE public.event_recap_sent ENABLE ROW LEVEL SECURITY;

-- Only service role can manage
CREATE POLICY "Service role can manage event recap sent"
ON public.event_recap_sent
FOR ALL
USING (true);

-- Insert default template if not exists
INSERT INTO public.email_templates (slug, name, subject, html_content, preview_text) 
VALUES (
  'end-of-night-recap',
  'Récap Fin de Soirée',
  'Last night at {{venue_name}} 🎉',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding-bottom: 24px;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                Last night at {{venue_name}} 🌙
              </h1>
              <p style="color: #a0a0a0; margin: 8px 0 0; font-size: 16px;">
                {{event_name}} - {{event_date}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: rgba(124, 58, 237, 0.2); border-radius: 12px; padding: 24px; text-align: center;">
              <p style="color: rgba(255,255,255,0.7); margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
                Your Night in Numbers
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="8" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td width="50%" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: #a855f7; margin: 0; font-size: 36px; font-weight: 800;">{{drinks_count}}</p>
              <p style="color: #a0a0a0; margin: 4px 0 0; font-size: 14px;">drinks ordered</p>
            </td>
            <td width="50%" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: #22c55e; margin: 0; font-size: 36px; font-weight: 800;">{{total_spent}}€</p>
              <p style="color: #a0a0a0; margin: 4px 0 0; font-size: 14px;">total spent</p>
            </td>
          </tr>
          <tr><td colspan="2" style="height: 8px;"></td></tr>
          <tr>
            <td width="50%" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: #f59e0b; margin: 0; font-size: 36px; font-weight: 800;">{{tickets_count}}</p>
              <p style="color: #a0a0a0; margin: 4px 0 0; font-size: 14px;">VIP tickets</p>
            </td>
            <td width="50%" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: #06b6d4; margin: 0; font-size: 36px; font-weight: 800;">0</p>
              <p style="color: #a0a0a0; margin: 4px 0 0; font-size: 14px;">min waiting</p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 16px 0;">
              <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                Thanks for partying with Yuno! 🎊
              </p>
              <a href="https://yuno-bar-buddy.lovable.app/profile" 
                 style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Profile
              </a>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 24px;">
          <tr>
            <td style="text-align: center;">
              <p style="color: #666666; margin: 0; font-size: 12px;">
                See you next time! 🚀
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  'Your night recap is here!'
)
ON CONFLICT (slug) DO NOTHING;
