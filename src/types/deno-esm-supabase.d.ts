// Des modules Deno partagés (supabase/functions/_shared/*) sont importés tels
// quels par le front et ses tests (ex. le rendu d'envoi email-studio-html.ts,
// vérifié par src/lib/email/__tests__/words.test.ts). Leur import de
// supabase-js passe par esm.sh, que le typage du front ne sait pas résoudre :
// c'est le même paquet que celui du front.
declare module 'https://esm.sh/@supabase/supabase-js@2.57.2' {
  export * from '@supabase/supabase-js';
}
