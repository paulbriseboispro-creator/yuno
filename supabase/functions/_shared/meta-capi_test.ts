// Tests unitaires de la normalisation Meta (doc « customer information
// parameters ») : une faute ici fait tomber la correspondance sans un mot.
// Lancer : cd supabase/functions && deno test --no-lock _shared/meta-capi_test.ts

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  normalizeEmail, normalizePhone, normalizeName, normalizeCity, normalizeCountry, splitFullName,
  sha256Hex, parseMetaClientContext, metaContextToStripeMetadata, metaContextFromStripeMetadata,
} from "./meta-capi.ts";

Deno.test("email : minuscules, espaces retirés, invalide → null", () => {
  assertEquals(normalizeEmail("  Paul.B@Example.COM "), "paul.b@example.com");
  assertEquals(normalizeEmail("pas-un-email"), null);
  assertEquals(normalizeEmail(null), null);
});

Deno.test("téléphone : chiffres, indicatif, sans + ni zéros de tête", () => {
  assertEquals(normalizePhone("+33 6 12 34 56 78"), "33612345678");
  assertEquals(normalizePhone("06 12 34 56 78"), "33612345678");
  assertEquals(normalizePhone("0033612345678"), "33612345678");
  assertEquals(normalizePhone("612 345 678", "ES"), "34612345678");
  assertEquals(normalizePhone("+34612345678", "ES"), "34612345678");
  assertEquals(normalizePhone("12", "FR"), null);
});

Deno.test("nom : minuscules, sans ponctuation ni chiffres, accents gardés", () => {
  assertEquals(normalizeName("  Jean-Éric O'Neil 2 "), "jeanéric oneil");
  assertEquals(normalizeName(""), null);
});

Deno.test("ville / pays", () => {
  assertEquals(normalizeCity("Saint-Étienne"), "saintétienne");
  assertEquals(normalizeCountry("fr"), "fr");
  assertEquals(normalizeCountry("France"), null);
});

Deno.test("nom complet découpé", () => {
  assertEquals(splitFullName("Marie Dupont Martin"), { first: "Marie", last: "Dupont Martin" });
  assertEquals(splitFullName("Marie"), { first: "Marie", last: null });
  assertEquals(splitFullName(""), { first: null, last: null });
});

Deno.test("sha256 hex minuscule (vecteur connu)", async () => {
  assertEquals((await sha256Hex("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("contexte client : natif ne consent jamais, cookies validés", () => {
  const web = parseMetaClientContext({ consent: true, src: "web", fbp: "fb.1.1700000000000.123456", fbc: "fb.1.1700000000000.AbC_xyz", url: "https://yunoapp.eu/event/x", consentVersion: 2 });
  assertEquals(web.consent, true);
  assertEquals(web.fbp, "fb.1.1700000000000.123456");
  assertEquals(web.fbc, "fb.1.1700000000000.AbC_xyz");
  assertEquals(web.url, "https://yunoapp.eu/event/x");
  const native = parseMetaClientContext({ consent: true, src: "native", fbp: "fb.1.1700000000000.123456" });
  assertEquals(native.consent, false);
  const bad = parseMetaClientContext({ consent: true, src: "web", fbp: "garbage", url: "https://evil.tld/x" });
  assertEquals(bad.fbp, null);
  assertEquals(bad.url, null);
});

Deno.test("aller-retour métadonnées Stripe", () => {
  const ctx = parseMetaClientContext({ consent: true, src: "web", fbp: "fb.1.1700000000000.1", url: "https://yunoapp.eu/e", consentVersion: 2 });
  const md = metaContextToStripeMetadata(ctx);
  assertEquals(md.meta_consent, "1");
  const back = metaContextFromStripeMetadata(md);
  assertEquals(back.consent, true);
  assertEquals(back.fbp, "fb.1.1700000000000.1");
  assertEquals(back.consentVersion, 2);
  assertEquals(metaContextFromStripeMetadata({ meta_consent: "1", meta_src: "native" }).consent, false);
});
