// Quand un QR lu doit-il être signalé à l'écran ? Règle de PRÉSENCE, sans
// minuterie arbitraire :
//  - un code est signalé quand il APPARAÎT devant la caméra ;
//  - tant qu'il reste devant (vu au moins une fois toutes les `absentMs`), il
//    n'est plus signalé : le billet encore sous la caméra ne se relit pas ;
//  - sorti du champ plus de `absentMs`, il redevient neuf : le même QR
//    présenté à nouveau est relu (« déjà scanné » s'affiche).
// Un code que l'écran REFUSE de prendre (un scan déjà en cours) n'est pas
// retenu : il sera proposé à la frame suivante, sans bip ni vibration.
//
// Pourquoi ce module : la bibliothèque du scanner ne relisait jamais deux fois
// de suite le même code (même sorti puis remis devant), et oubliait tout à
// chaque nouveau rendu de la page — d'où le bip de relecture en fond pendant
// que la carte verte s'affichait, et le QR re-présenté qui ne donnait rien.

export class QrPresence {
  private readonly lastSeen = new Map<string, number>();

  constructor(private readonly absentMs = 1200) {}

  /** Codes vus sur cette frame qui viennent d'APPARAÎTRE (à proposer à l'écran). */
  fresh(codes: readonly string[], now: number): string[] {
    for (const [code, at] of this.lastSeen) {
      if (now - at > this.absentMs) this.lastSeen.delete(code);
    }
    const out: string[] = [];
    for (const code of codes) {
      if (this.lastSeen.has(code)) this.lastSeen.set(code, now);
      else if (!out.includes(code)) out.push(code);
    }
    return out;
  }

  /** L'écran a pris ce code : il ne sera plus signalé tant qu'il reste devant. */
  accept(code: string, now: number): void {
    this.lastSeen.set(code, now);
  }

  reset(): void {
    this.lastSeen.clear();
  }
}
