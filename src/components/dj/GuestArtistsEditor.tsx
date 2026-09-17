import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
// lucide a retiré ses icônes de marque : l'Instagram du projet vit ici.
import { Instagram } from '@/components/icons/Instagram';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
 * La photo se met à la main : Instagram ne laisse plus aucun serveur lire un
 * profil public (vérifié le 2026-09-17). Le carnet évite que ce soit une
 * corvée récurrente — un artiste déjà programmé revient avec sa photo et son
 * Instagram en un clic, sur toutes les soirées suivantes.
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
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    void loadGuestArtistBook().then((rows) => { if (alive) setBook(rows); });
    return () => { alive = false; };
  }, [editing]);

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
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // 400 px suffisent : la vignette du line-up fait 108 pt sur la page
      // publique, et l'affiche d'une soirée ne doit pas peser une photo de plus.
      const compressed = await compressImage(file, 400, 0.85);
      // Le préfixe `<uid>/` n'est pas décoratif : la policy « Organizers upload
      // own event images » exige que le premier dossier soit l'identifiant du
      // compte. Sans lui, un organisateur se fait refuser l'upload.
      const path = `${user.id}/guest-artists/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await supabase.storage
        .from('event-images')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: false });
      if (error) return;
      const url = supabase.storage.from('event-images').getPublicUrl(path).data.publicUrl;
      setEditing((e) => (e ? { ...e, draft: { ...e.draft, photoUrl: url } } : e));
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
        {tt("Ils apparaissent sur l'affiche publique à la suite des DJ Yuno. Leur photo ouvre leur Instagram, et Yuno compte les clics.",
            'They appear on the public line-up after the Yuno DJs. Their photo opens their Instagram, and Yuno counts the clicks.',
            'Aparecen en el cartel público después de los DJ Yuno. Su foto abre su Instagram, y Yuno cuenta los clics.')}
      </p>

      {artists.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {artists.map((a, i) => (
            <div key={`${a.id || a.name}-${i}`} className="flex items-center gap-2 px-2 py-1.5">
              <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-muted">
                {a.photoUrl
                  ? <img src={a.photoUrl} alt="" className="h-full w-full object-cover" />
                  : <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">
                      {a.name.trim().charAt(0).toUpperCase() || '?'}
                    </div>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.name}</p>
                {a.instagramHandle && (
                  <p className="text-[10px] text-muted-foreground truncate">@{a.instagramHandle}</p>
                )}
              </div>
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
                  className="p-1 rounded hover:bg-muted disabled:opacity-25" aria-label="up">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === artists.length - 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-25" aria-label="down">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => openEdit(i)} className="p-1 rounded hover:bg-muted" aria-label="edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => remove(i)} className="p-1 rounded hover:bg-destructive/20" aria-label="remove">
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
                {/* Dit franchement pourquoi il n'y a pas de bouton magique. */}
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
                  {tt("Instagram n'autorise plus aucun site à récupérer une photo de profil : il faut l'enregistrer depuis son compte, puis la choisir ici. C'est à faire une seule fois — l'artiste revient ensuite tout seul dans « Déjà programmés chez toi ».",
                      'Instagram no longer lets any site fetch a profile picture: save it from their account, then pick it here. Once is enough — the artist then comes back on their own under “Already booked by you”.',
                      'Instagram ya no permite a ningún sitio recuperar una foto de perfil: guárdala desde su cuenta y elígela aquí. Solo una vez — después el artista vuelve solo en «Ya programados por ti».')}
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
