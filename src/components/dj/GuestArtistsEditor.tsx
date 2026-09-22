import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
// lucide a retiré ses icônes de marque : l'Instagram du projet vit ici.
import { Instagram } from '@/components/icons/Instagram';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { compressImage } from '@/lib/compressImage';
import {
  GUEST_ARTIST_NAME_MAX,
  loadGuestArtistBook,
  normalizeInstagramHandle,
  type BookEntry,
  type GuestArtist,
} from '@/lib/guestArtists';

interface Props {
  artists: GuestArtist[];
  onChange: (artists: GuestArtist[]) => void;
}

const EMPTY: GuestArtist = { name: '', photoUrl: null, instagram: null };

/**
 * Line-up invité — les artistes qui n'ont pas de compte Yuno.
 *
 * Un nom, une photo, un lien Instagram : c'est tout ce qu'un club a besoin de
 * dire d'un artiste de passage, et c'est tout ce qu'on stocke. Rien ici ne crée
 * de profil DJ, de demande de booking ni de cachet — le sélecteur du dessus
 * s'en charge pour les artistes qui, eux, peuvent répondre.
 *
 * Rien n'y est figé : la ligne, la vignette et le crayon ouvrent tous la même
 * modification, et la photo d'un artiste se change à tout moment. Le carnet
 * (`get_guest_artist_book`) sert la version la PLUS RÉCENTE de chaque artiste,
 * donc corriger une photo ici la corrige pour toutes les soirées à venir.
 */
export function GuestArtistsEditor({ artists, onChange }: Props) {
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const [editing, setEditing] = useState<{ index: number | null; draft: GuestArtist } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [book, setBook] = useState<BookEntry[]>([]);
  const [bookQuery, setBookQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Le carnet ne se charge qu'à l'ouverture du dialogue : c'est une commodité,
  // elle n'a rien à faire dans le chemin de rendu du formulaire de soirée.
  // `editing` est un objet recréé à chaque frappe : le mettre en dépendance
  // relançait la RPC du carnet à chaque lettre du nom. C'est l'OUVERTURE du
  // dialogue qui compte, rien d'autre.
  const dialogOpen = editing !== null;
  useEffect(() => {
    if (!dialogOpen) return;
    let alive = true;
    void loadGuestArtistBook().then((rows) => { if (alive) setBook(rows); });
    return () => { alive = false; };
  }, [dialogOpen]);

  const openNew = () => { setBookQuery(''); setEditing({ index: null, draft: { ...EMPTY } }); };
  const openEdit = (i: number) => { setBookQuery(''); setEditing({ index: i, draft: { ...artists[i] } }); };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= artists.length) return;
    const next = [...artists];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => onChange(artists.filter((_, k) => k !== i));

  const commit = () => {
    if (!editing) return;
    const draft = { ...editing.draft, name: editing.draft.name.trim() };
    if (!draft.name) return;
    const next = [...artists];
    if (editing.index === null) next.push(draft);
    else next[editing.index] = draft;
    onChange(next);
    setEditing(null);
  };

  const pickPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(tt('Ce fichier n’est pas une image.', 'That file is not an image.', 'Ese archivo no es una imagen.'));
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error(tt('Session expirée — reconnecte-toi.', 'Session expired — sign in again.', 'Sesión caducada — vuelve a iniciar sesión.'));
        return;
      }
      // 400 px suffisent : la vignette du line-up fait 108 pt sur la page
      // publique, et l'affiche d'une soirée ne doit pas peser une photo de plus.
      const compressed = await compressImage(file, 400, 0.85);
      // `compressImage` REND LE FICHIER D'ORIGINE quand la compression ne gagne
      // rien, et quand le navigateur ne sait pas décoder l'image (un HEIC
      // d'iPhone dans Chrome, par exemple). L'annoncer en `image/jpeg` avec une
      // extension `.jpg` posait alors des octets HEIC sous un nom de JPEG :
      // l'upload passait, et la photo ne s'affichait nulle part. On envoie le
      // type RÉEL du blob, et on laisse le HEIC dehors plutôt que de le
      // stocker pour rien.
      const type = compressed.type || file.type;
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) {
        toast.error(tt(
          'Ce format d’image n’est pas lisible par les navigateurs (HEIC ?). Exporte-la en JPEG ou PNG.',
          'Browsers cannot read this image format (HEIC?). Export it as JPEG or PNG.',
          'Los navegadores no pueden leer este formato (¿HEIC?). Expórtala en JPEG o PNG.',
        ));
        return;
      }
      const ext = type === 'image/png' ? 'png'
        : type === 'image/webp' ? 'webp'
        : type === 'image/gif' ? 'gif'
        : type === 'image/avif' ? 'avif'
        : 'jpg';
      // Le préfixe `<uid>/` n'est pas décoratif : la policy « Own folder
      // upload event images » exige que le premier dossier soit l'identifiant
      // du compte. C'est la SEULE porte d'écriture qui ne demande pas de rôle,
      // donc la seule qu'un organisateur (ou son équipe) franchit.
      const path = `${user.id}/guest-artists/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from('event-images')
        .upload(path, compressed, { contentType: type, upsert: false });
      // Un refus muet, c'est un pro qui recommence trois fois et croit que Yuno
      // est cassé. Il n'y a rien à cacher : on dit ce que le serveur a dit.
      if (error) {
        toast.error(tt(
          `La photo n’a pas pu être envoyée : ${error.message}`,
          `The photo could not be uploaded: ${error.message}`,
          `No se pudo enviar la foto: ${error.message}`,
        ));
        return;
      }
      const url = supabase.storage.from('event-images').getPublicUrl(path).data.publicUrl;
      setEditing((e) => (e ? { ...e, draft: { ...e.draft, photoUrl: url } } : e));
    } catch (err) {
      toast.error(tt(
        'La photo n’a pas pu être envoyée.',
        'The photo could not be uploaded.',
        'No se pudo enviar la foto.',
      ));
      console.error('[guest-artist] upload', err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const draft = editing?.draft;
  const draftHandle = normalizeInstagramHandle(draft?.instagram);
  const instagramTyped = !!(draft?.instagram || '').trim();

  const filteredBook = book.filter((b) => {
    if (artists.some((a) => a.name.trim().toLowerCase() === b.name.toLowerCase())) return false;
    const q = bookQuery.trim().toLowerCase();
    return !q || b.name.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-2">
      <Label className="text-sm flex items-center gap-1">
        <UserPlus className="h-3 w-3" />
        {tt('Artistes sans compte Yuno', 'Artists without a Yuno account', 'Artistas sin cuenta Yuno')}
      </Label>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {tt("Ils apparaissent sur l'affiche publique à la suite des DJ Yuno. Leur photo ouvre leur Instagram, et Yuno compte les clics. Touche un artiste pour le modifier.",
            'They appear on the public line-up after the Yuno DJs. Their photo opens their Instagram, and Yuno counts the clicks. Tap an artist to edit them.',
            'Aparecen en el cartel público después de los DJ Yuno. Su foto abre su Instagram, y Yuno cuenta los clics. Toca un artista para editarlo.')}
      </p>

      {artists.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {artists.map((a, i) => (
            <div key={`${a.id || a.name}-${i}`} className="flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => openEdit(i)}
                className="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-muted"
                title={tt('Changer la photo', 'Change the photo', 'Cambiar la foto')}
              >
                {a.photoUrl
                  ? <img src={a.photoUrl} alt="" className="h-full w-full object-cover" />
                  : <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">
                      {a.name.trim().charAt(0).toUpperCase() || '?'}
                    </div>}
              </button>
              {/* Toute la ligne ouvre la modification : le crayon seul est une
                  cible de 14 px que personne ne trouve, et rien ici n'est
                  définitif — photo, Instagram et nom se changent quand on veut. */}
              <button
                type="button"
                onClick={() => openEdit(i)}
                className="min-w-0 flex-1 text-left"
                title={tt('Modifier cet artiste', 'Edit this artist', 'Editar este artista')}
              >
                <p className="text-sm font-medium truncate">{a.name}</p>
                {a.instagramHandle && (
                  <p className="text-[10px] text-muted-foreground truncate">@{a.instagramHandle}</p>
                )}
              </button>
              {(a.clicks ?? 0) > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0"
                  title={tt('Clics vers son Instagram', 'Clicks to their Instagram', 'Clics a su Instagram')}
                >
                  <Instagram className="h-3 w-3" />{a.clicks}
                </span>
              )}
              <div className="flex items-center shrink-0">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-1 rounded hover:bg-muted disabled:opacity-25"
                  aria-label={tt('Monter', 'Move up', 'Subir')} title={tt('Monter', 'Move up', 'Subir')}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === artists.length - 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-25"
                  aria-label={tt('Descendre', 'Move down', 'Bajar')} title={tt('Descendre', 'Move down', 'Bajar')}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => openEdit(i)} className="p-1 rounded hover:bg-muted"
                  aria-label={tt('Modifier', 'Edit', 'Editar')} title={tt('Modifier', 'Edit', 'Editar')}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => remove(i)} className="p-1 rounded hover:bg-destructive/20"
                  aria-label={tt('Retirer', 'Remove', 'Quitar')} title={tt('Retirer', 'Remove', 'Quitar')}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={openNew}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {tt('Ajouter un artiste', 'Add an artist', 'Añadir un artista')}
      </button>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing?.index === null
                ? tt('Ajouter un artiste', 'Add an artist', 'Añadir un artista')
                : tt("Modifier l'artiste", 'Edit artist', 'Editar artista')}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              {/* Carnet : les artistes déjà programmés, avec leur photo. */}
              {editing?.index === null && book.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {tt('Déjà programmés chez toi', 'Already booked by you', 'Ya programados por ti')}
                  </label>
                  {book.length > 5 && (
                    <Input
                      value={bookQuery}
                      onChange={(e) => setBookQuery(e.target.value)}
                      placeholder={tt('Rechercher…', 'Search…', 'Buscar…')}
                      className="h-8 text-xs"
                    />
                  )}
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {filteredBook.slice(0, 24).map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        onClick={() => setEditing((e) => (e ? {
                          ...e,
                          draft: { name: b.name, photoUrl: b.photoUrl, instagram: b.instagram },
                        } : e))}
                        className="flex items-center gap-1.5 rounded-full border border-border pl-1 pr-2.5 py-1 hover:bg-muted transition-colors"
                      >
                        <span className="h-5 w-5 rounded-full overflow-hidden bg-muted shrink-0">
                          {b.photoUrl
                            ? <img src={b.photoUrl} alt="" className="h-full w-full object-cover" />
                            : null}
                        </span>
                        <span className="text-xs">{b.name}</span>
                      </button>
                    ))}
                    {filteredBook.length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">
                        {tt('Tous déjà à l\'affiche.', 'All already on the line-up.', 'Todos ya en el cartel.')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {tt('Nom de scène', 'Stage name', 'Nombre artístico')} *
                </label>
                <Input
                  value={draft.name}
                  maxLength={GUEST_ARTIST_NAME_MAX}
                  onChange={(e) => setEditing((s) => (s ? { ...s, draft: { ...s.draft, name: e.target.value } } : s))}
                  placeholder={tt('Ex. : Amoris', 'e.g. Amoris', 'Ej.: Amoris')}
                  autoFocus
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                  <Instagram className="h-3.5 w-3.5" />{tt('Instagram', 'Instagram', 'Instagram')}
                </label>
                <Input
                  value={draft.instagram || ''}
                  onChange={(e) => setEditing((s) => (s ? { ...s, draft: { ...s.draft, instagram: e.target.value } } : s))}
                  placeholder="@amoris.paris"
                />
                {instagramTyped && (
                  <p className={`mt-1 text-[11px] ${draftHandle ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {draftHandle
                      ? `instagram.com/${draftHandle}`
                      : tt("Ce n'est pas un compte Instagram — le lien ne sera pas posé.",
                           'Not an Instagram account — the link will not be added.',
                           'No es una cuenta de Instagram — el enlace no se añadirá.')}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {tt('Photo', 'Photo', 'Foto')}
                </label>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-muted border border-border">
                    {draft.photoUrl
                      ? <img src={draft.photoUrl} alt="" className="h-full w-full object-cover" />
                      : <div className="h-full w-full flex items-center justify-center text-muted-foreground text-lg">
                          {draft.name.trim().charAt(0).toUpperCase() || '?'}
                        </div>}
                  </div>
                  <div className="flex-1 space-y-1">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {uploading && <Loader2 className="h-3 w-3 animate-spin" />}
                      {draft.photoUrl
                        ? tt('Changer la photo', 'Change photo', 'Cambiar la foto')
                        : tt('Choisir une photo', 'Choose a photo', 'Elegir una foto')}
                    </button>
                    {draft.photoUrl && (
                      <button
                        type="button"
                        onClick={() => setEditing((s) => (s ? { ...s, draft: { ...s.draft, photoUrl: null } } : s))}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />{tt('Retirer', 'Remove', 'Quitar')}
                      </button>
                    )}
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); }}
                />
                {/* Ce qui compte pour le pro : il ne la remettra pas chaque semaine. */}
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
                  {tt("Une fois ajoutée, la photo reste en mémoire : l'artiste revient avec elle dans « Déjà programmés chez toi » sur tes prochaines soirées. Tu peux la changer quand tu veux.",
                      'Once added, the photo is remembered: the artist comes back with it under “Already booked by you” on your next events. You can change it whenever you want.',
                      'Una vez añadida, la foto queda guardada: el artista vuelve con ella en «Ya programados por ti» en tus próximos eventos. Puedes cambiarla cuando quieras.')}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="flex-1 rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground"
                >
                  {tt('Annuler', 'Cancel', 'Cancelar')}
                </button>
                <button
                  type="button"
                  onClick={commit}
                  disabled={!draft.name.trim()}
                  className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {editing?.index === null
                    ? tt('Ajouter', 'Add', 'Añadir')
                    : tt('Enregistrer', 'Save', 'Guardar')}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
