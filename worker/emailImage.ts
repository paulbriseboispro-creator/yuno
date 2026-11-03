// Images des e-mails servies depuis yunoapp.eu : `/email-img/<bucket>/<fichier>`
// (règles et liste des buckets dans supabase/functions/_shared/email-image-host.ts).
// Le Worker relit l'image dans le stockage public de Supabase et la met en
// cache chez Cloudflare : Gmail ne voit plus supabase.co dans l'e-mail.
import { emailImageStoragePath } from '../supabase/functions/_shared/email-image-host';

export { emailImageStoragePath };

export async function handleEmailImage(request: Request, supabaseUrl: string, pathname: string): Promise<Response> {
  const storagePath = emailImageStoragePath(pathname);
  if (!storagePath) return new Response('Not found', { status: 404 });
  const upstream = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${storagePath}`,
    { method: request.method === 'HEAD' ? 'HEAD' : 'GET' },
  );
  const type = upstream.headers.get('Content-Type') || '';
  if (!upstream.ok || !type.startsWith('image/')) {
    return new Response('Not found', { status: upstream.status === 404 || upstream.ok ? 404 : 502 });
  }
  const headers = new Headers();
  headers.set('Content-Type', type);
  const len = upstream.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  headers.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
}
