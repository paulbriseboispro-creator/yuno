// Confirmation des outils d'écriture de l'Assistant Console, appliquée par le
// serveur et pas seulement par le prompt : un outil qui MODIFIE des données
// n'est exécuté que si le modèle passe `confirmed: true`, ce qu'il ne doit
// faire qu'après un oui explicite de l'owner au résumé de l'action.
// Module pur (sans import Deno) : testé par src/lib/__tests__/ownerAssistantWriteGuard.test.ts.

export const WRITE_TOOLS = new Set([
  "activate_ticket_round", "toggle_drink", "update_drink_price", "toggle_post_checkout_upsell",
  "toggle_event_ticketing", "update_event", "toggle_guest_list", "toggle_event_tables",
  "set_night_brief", "set_email_automation",
]);

const CONFIRMED_PARAM = {
  type: "boolean",
  description: "true seulement après un oui explicite de l'owner au résumé de l'action. Sinon false.",
} as const;

interface ToolSchema {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required?: string[] };
  };
}

// Ajoute le paramètre requis `confirmed` au schéma de chaque outil d'écriture.
export function withConfirmationParam<T extends ToolSchema>(tools: T[]): T[] {
  return tools.map((t) => {
    if (!WRITE_TOOLS.has(t.function.name)) return t;
    const params = t.function.parameters;
    return {
      ...t,
      function: {
        ...t.function,
        parameters: {
          ...params,
          properties: { ...params.properties, confirmed: CONFIRMED_PARAM },
          required: [...(params.required ?? []).filter((r) => r !== "confirmed"), "confirmed"],
        },
      },
    };
  });
}

export type WriteGuardResult<A> =
  | { ok: true; args: A }
  | { ok: false; payload: { error: "confirmation_required"; message: string } };

// Rend les arguments sans `confirmed` si l'appel peut partir, sinon le
// résultat d'outil à renvoyer au modèle. Un outil de lecture passe tel quel.
export function checkWriteConfirmation<A extends Record<string, unknown>>(
  fnName: string,
  args: A,
): WriteGuardResult<Omit<A, "confirmed">> {
  const { confirmed, ...rest } = args;
  if (!WRITE_TOOLS.has(fnName)) return { ok: true, args: rest };
  if (confirmed === true) return { ok: true, args: rest };
  return {
    ok: false,
    payload: {
      error: "confirmation_required",
      message: "Action non exécutée : elle modifie des données. Résume-la en **gras** (quoi, sur quel objet, avec quelle valeur), demande « **Tu confirmes ?** », puis rappelle cet outil avec confirmed: true seulement après un oui explicite de l'owner.",
    },
  };
}
