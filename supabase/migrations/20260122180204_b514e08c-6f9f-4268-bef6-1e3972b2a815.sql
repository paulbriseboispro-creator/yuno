
-- Add more template variations for different customer profiles
INSERT INTO public.email_templates (slug, name, subject, html_content, preview_text) VALUES 
(
  'recap-first-timer',
  'Récap - Première visite',
  'Your first night at {{venue_name}} 🎉',
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
                Welcome to the family{{#if first_name}}, {{first_name}}{{/if}}! 🎊
              </h1>
              <p style="color: #a0a0a0; margin: 8px 0 0; font-size: 16px;">
                Your first night at {{venue_name}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px; font-weight: 600;">
                🌟 First visit complete! You are now part of our community
              </p>
            </td>
          </tr>
        </table>
        {{stats_section}}
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 24px 0;">
              <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                Start earning points on every order!
              </p>
              <a href="https://yuno-bar-buddy.lovable.app/profile" 
                 style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Profile
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  'Welcome to the family!'
),
(
  'recap-vip-spender',
  'Récap - VIP / Gros dépenseur',
  'What a night, {{first_name}}! 💎',
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
                VIP treatment, VIP results 💎
              </h1>
              <p style="color: #a0a0a0; margin: 8px 0 0; font-size: 16px;">
                {{event_name}} • {{event_date}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px; font-weight: 600;">
                👑 You were in the top spenders of the night!
              </p>
            </td>
          </tr>
        </table>
        {{stats_section}}
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 24px 0;">
              <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                Your loyalty is rewarded. Check your exclusive perks!
              </p>
              <a href="https://yuno-bar-buddy.lovable.app/profile" 
                 style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Rewards
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  'VIP treatment, VIP results!'
),
(
  'recap-loyal-regular',
  'Récap - Client fidèle',
  'Another great night{{#if first_name}}, {{first_name}}{{/if}}! 🔥',
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
                You know the drill 🔥
              </h1>
              <p style="color: #a0a0a0; margin: 8px 0 0; font-size: 16px;">
                Visit #{{visit_count}} at {{venue_name}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px; font-weight: 600;">
                ⭐ {{tier}} member • {{total_lifetime_points}} lifetime points
              </p>
            </td>
          </tr>
        </table>
        {{stats_section}}
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 24px 0;">
              <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                Keep the streak going! See you next time 🚀
              </p>
              <a href="https://yuno-bar-buddy.lovable.app/profile" 
                 style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Stats
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  'Another great night with us!'
),
(
  'recap-ticket-buyer',
  'Récap - Acheteur de tickets',
  '{{event_name}} was epic! 🎫',
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
                {{event_name}} was 🔥
              </h1>
              <p style="color: #a0a0a0; margin: 8px 0 0; font-size: 16px;">
                {{event_date}} • {{venue_name}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 16px; font-weight: 600;">
                🎫 You were there! Thanks for being part of it
              </p>
            </td>
          </tr>
        </table>
        {{stats_section}}
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 24px 0;">
              <p style="color: #a0a0a0; margin: 0 0 16px; font-size: 14px;">
                Don''t miss our next events!
              </p>
              <a href="https://yuno-bar-buddy.lovable.app/club/{{venue_slug}}" 
                 style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                See Upcoming Events
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  'What an event!'
)
ON CONFLICT (slug) DO NOTHING;

-- Update the default template to use dynamic stats section
UPDATE public.email_templates 
SET html_content = '<!DOCTYPE html>
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
                {{event_name}} • {{event_date}}
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td style="background: rgba(124, 58, 237, 0.2); border-radius: 12px; padding: 20px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
                Your Night in Numbers
              </p>
            </td>
          </tr>
        </table>
        {{stats_section}}
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 24px 0;">
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
      </td>
    </tr>
  </table>
</body>
</html>'
WHERE slug = 'end-of-night-recap';
