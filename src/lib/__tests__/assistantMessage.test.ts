import { describe, it, expect } from 'vitest';
import { parseAssistantMessage } from '../assistantMessage';

const A = 'cb621ee2-7934-4918-8a82-714337c79a56';
const B = '9a9d368f-df25-457c-a56a-e997c7a3eb31';

describe('parseAssistantMessage', () => {
  it('sépare la prose de la carte', () => {
    const segs = parseAssistantMessage(`Il y a une soirée à Paris :\n\n[[event:${A}]]\n\nTu veux la guest list ?`);
    expect(segs).toEqual([
      { kind: 'text', text: 'Il y a une soirée à Paris :' },
      { kind: 'events', ids: [A] },
      { kind: 'text', text: 'Tu veux la guest list ?' },
    ]);
  });

  it('groupe deux cartes qui se suivent en un seul rail', () => {
    const segs = parseAssistantMessage(`Voilà :\n[[event:${A}]]\n[[event:${B}]]`);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toEqual({ kind: 'events', ids: [A, B] });
  });

  it('ne groupe pas deux cartes séparées par du texte', () => {
    const segs = parseAssistantMessage(`[[event:${A}]]\nEt sinon :\n[[event:${B}]]`);
    expect(segs.map((s) => s.kind)).toEqual(['events', 'text', 'events']);
  });

  it('ne répète pas deux fois le même id dans un rail', () => {
    const segs = parseAssistantMessage(`[[event:${A}]] [[event:${A}]]`);
    expect(segs).toEqual([{ kind: 'events', ids: [A] }]);
  });

  it('tolère les espaces que le modèle glisse dans le jeton', () => {
    expect(parseAssistantMessage(`[[ event : ${A} ]]`)).toEqual([{ kind: 'events', ids: [A] }]);
  });

  it('masque un jeton encore incomplet pendant le streaming', () => {
    // La réponse arrive caractère par caractère : « [[event:cb62 » ne doit
    // jamais clignoter en clair dans la bulle.
    const segs = parseAssistantMessage('Une soirée à Paris :\n\n[[event:cb621ee2-79');
    expect(segs).toEqual([{ kind: 'text', text: 'Une soirée à Paris :' }]);
  });

  it('laisse passer un message sans jeton', () => {
    const segs = parseAssistantMessage('Les remboursements sont traités par le club.');
    expect(segs).toEqual([{ kind: 'text', text: 'Les remboursements sont traités par le club.' }]);
  });

  it('efface un jeton mal formé au lieu de le montrer en clair', () => {
    expect(parseAssistantMessage('[[event:woh-face-to-face]]')).toEqual([]);
    expect(parseAssistantMessage('Voilà : [[event:pas-un-uuid]] ça te dit ?')).toEqual([
      { kind: 'text', text: 'Voilà :  ça te dit ?' },
    ]);
  });
});

describe('étiquettes de notes internes', () => {
  it('n\'affiche jamais « CARTE= » quand le modèle le recopie', () => {
    const segs = parseAssistantMessage(`Voici :\n  CARTE= [[event:${A}]]`);
    expect(segs).toEqual([
      { kind: 'text', text: 'Voici :' },
      { kind: 'events', ids: [A] },
    ]);
  });

  it('n\'affiche jamais « Carte à coller : » non plus', () => {
    const segs = parseAssistantMessage(`Carte à coller : [[event:${A}]]`);
    expect(segs).toEqual([{ kind: 'events', ids: [A] }]);
  });
});

describe('puces que le modèle ajoute autour des cartes', () => {
  it('efface la puce qui ne fait que répéter le titre de la carte', () => {
    const segs = parseAssistantMessage(
      `Voici ce qui se passe :\n\n- **Teatro Kapital SUNDAY**\n  🔗 [[event:${A}]]\n\n- **Los Amantes**\n  🔗 [[event:${B}]]`,
    );
    expect(segs).toEqual([
      { kind: 'text', text: 'Voici ce qui se passe :' },
      { kind: 'events', ids: [A, B] },
    ]);
  });

  it('garde une puce qui dit autre chose que le titre', () => {
    const segs = parseAssistantMessage(`- **Conseil** : arrive avant 1h\n[[event:${A}]]`);
    expect(segs[0]).toEqual({ kind: 'text', text: '- **Conseil** : arrive avant 1h' });
    expect(segs[1]).toEqual({ kind: 'events', ids: [A] });
  });
});
