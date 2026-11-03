import { describe, expect, it } from 'vitest';
import { emailImageStoragePath, rehostEmailImages } from '../../../../supabase/functions/_shared/email-image-host';

const SB = 'https://fulawxvdlwtdlpkycixe.supabase.co';

describe('rehostEmailImages', () => {
  it('sert les images des buckets d\'e-mail depuis yunoapp.eu', () => {
    const html = `<img src="${SB}/storage/v1/object/public/email-assets/mcp/abc/image.jpg"><td style="background-image:url(${SB}/storage/v1/object/public/event-posters/x.png)">`;
    expect(rehostEmailImages(html, SB, 'https://yunoapp.eu')).toBe(
      '<img src="https://yunoapp.eu/email-img/email-assets/mcp/abc/image.jpg"><td style="background-image:url(https://yunoapp.eu/email-img/event-posters/x.png)">',
    );
  });
  it('laisse les autres buckets et les autres domaines', () => {
    const html = `<a href="${SB}/storage/v1/object/public/minor-auth-uploads/a.pdf">x</a><img src="https://images.shotgun.live/a.jpg">`;
    expect(rehostEmailImages(html, SB, 'https://yunoapp.eu')).toBe(html);
  });
});

describe('emailImageStoragePath', () => {
  it('lit un chemin servable', () => {
    expect(emailImageStoragePath('/email-img/email-assets/mcp/abc/image.jpg')).toBe('email-assets/mcp/abc/image.jpg');
  });
  it('refuse un bucket hors liste et les remontées', () => {
    expect(emailImageStoragePath('/email-img/minor-auth-uploads/a.pdf')).toBeNull();
    expect(emailImageStoragePath('/email-img/email-assets/../minor-auth-uploads/a.pdf')).toBeNull();
    expect(emailImageStoragePath('/email-img/email-assets/')).toBeNull();
    expect(emailImageStoragePath('/email-img/')).toBeNull();
  });
});
