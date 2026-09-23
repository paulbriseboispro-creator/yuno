#!/usr/bin/env python3
"""Fusionne les réécritures d'articles (JSON) dans les données et les locales.

  python3 scripts/help/merge-rewrites.py <dossier rewrites> [--dry]

Pour chaque <id>.json (contrat : scratchpad REWRITE_SPEC.md) :
- remplace le bloc `sections: [...]` de l'article dans src/data/<file>.ts
  (clés <ns>.sNh / <ns>.sNb, type, screenshotUrl conservé ou marqué à capturer) ;
- remplace titre / description / mots-clés ;
- dans src/i18n/locales/help/{en,fr,es}.ts, retire les anciennes clés de
  l'article (celles que ses sections référençaient) et écrit les nouvelles.
Un article partagé (même ns référencé par deux entrées, ex. Meta club + orga)
est mis à jour dans toutes les entrées qui portent ce ns.
Écrit `pending-captures.json` : les captures demandées ("capture"), route et
fichier cible, à prendre ensuite.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = sys.argv[1]
DRY = '--dry' in sys.argv
LANGS = ('en', 'fr', 'es')
FILES = ('ownerHelpContent', 'organizerHelpContent', 'agencyHelpContent')
SCOPE = {'ownerHelpContent': 'owner', 'organizerHelpContent': 'org', 'agencyHelpContent': 'agency'}

def ts_str(s: str) -> str:
    """Chaîne TypeScript entre guillemets doubles (JSON est un sous-ensemble valide)."""
    return json.dumps(s, ensure_ascii=False)

ART_RE = r"\n      \{\n((?:\s*//[^\n]*\n)*\s*id: '([^']+)',.*?)\n      \},"

def find_article(src: str, aid: str):
    for m in re.finditer(ART_RE, src, re.S):
        if m.group(2) == aid:
            return m
    return None

def article_keys(body: str):
    keys = set(re.findall(r"(?:headingKey|bodyKey|titleKey|descKey): '([^']+)'", body))
    return keys

rewrites = []
for name in sorted(os.listdir(SRC)):
    if not name.endswith('.json'):
        continue
    p = os.path.join(SRC, name)
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        print(f'!! JSON invalide : {name} — {e}')
        continue
    ok = True
    for f in ('file', 'id', 'ns', 'title', 'desc', 'sections'):
        if f not in d:
            print(f'!! {name} : champ {f} manquant'); ok = False
    if not ok:
        continue
    for s in d['sections']:
        for f in ('key', 'heading', 'body'):
            if f not in s:
                print(f'!! {name} : section sans {f}'); ok = False
        for lang in LANGS:
            if not (s.get('heading', {}).get(lang) and s.get('body', {}).get(lang)):
                print(f'!! {name} : section {s.get("key")} sans texte {lang}'); ok = False
    for lang in LANGS:
        if not (d['title'].get(lang) and d['desc'].get(lang)):
            print(f'!! {name} : titre/desc sans {lang}'); ok = False
    if ok:
        rewrites.append(d)

print(f'{len(rewrites)} réécritures valides')

data_src = {f: open(f'{ROOT}/src/data/{f}.ts', encoding='utf-8').read() for f in FILES}
loc_src = {lang: open(f'{ROOT}/src/i18n/locales/help/{lang}.ts', encoding='utf-8').read() for lang in LANGS}
new_keys = {lang: {} for lang in LANGS}
dead_keys = set()
captures = []

for d in rewrites:
    ns = d['ns']
    # Toutes les entrées (tous fichiers) dont les sections référencent ce ns.
    targets = []
    for f in FILES:
        for m in re.finditer(ART_RE, data_src[f], re.S):
            if re.search(rf"headingKey: '{re.escape(ns)}\.s\d+h'", m.group(1)) or (f == d['file'] and m.group(2) == d['id']):
                targets.append((f, m.group(2)))
    if not targets:
        print(f'!! {d["id"]} : article introuvable'); continue
    for f, aid in targets:
        src = data_src[f]
        m = find_article(src, aid)
        body = m.group(1)
        old_keys = article_keys(body)
        title_key = re.search(r"titleKey: '([^']+)'", body).group(1)
        desc_key = re.search(r"descKey: '([^']+)'", body).group(1)
        # Article qui reçoit un ns à lui (ex. org-ads séparé de ads) : titre et
        # description changent de clé aussi, sinon ils resteraient partagés.
        old_ns_m = re.search(r"headingKey: '(ohelp\.[^']+)\.s\d+h'", body)
        if old_ns_m and old_ns_m.group(1) != ns:
            new_title, new_desc = f"{ns}.title", f"{ns}.desc"
            body = body.replace(f"titleKey: '{title_key}'", f"titleKey: '{new_title}'", 1).replace(f"descKey: '{desc_key}'", f"descKey: '{new_desc}'", 1)
            title_key, desc_key = new_title, new_desc
        existing_shot = re.search(r"screenshotUrl: '([^']+)'", body)
        shot_mode = d.get('screenshot', 'existing' if existing_shot else 'none')
        shot_url = None
        if shot_mode == 'existing' and existing_shot:
            shot_url = existing_shot.group(1)
        elif shot_mode == 'capture':
            route = d.get('screenshotRoute') or d.get('actionPath') or (re.search(r"path: '([^']+)'", body) or [None, None])[1]
            if route:
                shot_url = f'/help/{SCOPE[f]}-{aid}.webp'
                captures.append({'file': f, 'id': aid, 'route': route, 'target': f'{ROOT}/public{shot_url}', 'url': shot_url})
        # Sections
        lines = []
        for s in d['sections']:
            hk, bk = f"{ns}.{s['key']}h", f"{ns}.{s['key']}b"
            extra = ''
            if s.get('type'):
                extra += f", type: '{s['type']}'"
            if s.get('screenshot') and shot_url:
                extra += f", screenshotUrl: '{shot_url}'"
            lines.append(f"          {{ headingKey: '{hk}', bodyKey: '{bk}'{extra} }},")
            for lang in LANGS:
                new_keys[lang][hk] = s['heading'][lang]
                new_keys[lang][bk] = s['body'][lang]
        sections_block = "sections: [\n" + "\n".join(lines) + "\n        ],"
        new_body = re.sub(r"sections: \[.*?\n        \],", lambda _m: sections_block, body, count=1, flags=re.S)
        if d.get('keywords'):
            kw = ", ".join("'" + k.replace("\\", "\\\\").replace("'", "\\'") + "'" for k in d['keywords'])
            if re.search(r"keywords: \[.*?\]", new_body, re.S):
                new_body = re.sub(r"keywords: \[.*?\]", lambda _m: f"keywords: [{kw}]", new_body, count=1, flags=re.S)
            else:
                new_body = new_body.replace("\n        sections: [", f"\n        keywords: [{kw}],\n        sections: [", 1)
        # actionPath (articles organisateur sans lien) : crée le lien « Ouvrir cette page ».
        if d.get('actionPath'):
            if 'actionLink:' in new_body:
                new_body = re.sub(r"actionLink: \{ labelKey: '([^']+)', path: '[^']+' \}",
                                  lambda mm: f"actionLink: {{ labelKey: '{mm.group(1)}', path: '{d['actionPath']}' }}", new_body, count=1)
            else:
                new_body = new_body.replace("\n        sections: [", f"\n        actionLink: {{ labelKey: 'ohelp.org.openPage', path: '{d['actionPath']}' }},\n        sections: [", 1)
        new_keys_here = article_keys(new_body)
        dead_keys.update(old_keys - new_keys_here)
        for lang in LANGS:
            new_keys[lang][title_key] = d['title'][lang]
            new_keys[lang][desc_key] = d['desc'][lang]
        data_src[f] = src[:m.start(1)] + new_body + src[m.end(1):]
        print(f'· {f}/{aid} : {len(d["sections"])} sections, capture={shot_mode}')

# Locales : on retire les clés mortes et les clés réécrites, puis on ajoute un bloc.
KEY_LINE = re.compile(r"""^\s*["'](ohelp\.[^"']+)["']:\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),?\s*\n""", re.M)
for lang in LANGS:
    src = loc_src[lang]
    replaced = set(new_keys[lang])
    def drop(m):
        k = m.group(1)
        return '' if (k in dead_keys or k in replaced) else m.group(0)
    src = KEY_LINE.sub(drop, src)
    marker = '\n};\n\nexport default help;\n'
    assert src.endswith(marker), lang
    block = ["  // ─── Articles réécrits (pipeline scripts/help/merge-rewrites.py) ───"]
    for k in sorted(new_keys[lang]):
        block.append(f"  {ts_str(k)}: {ts_str(new_keys[lang][k])},")
    src = src[:-len(marker)] + '\n' + '\n'.join(block) + marker
    loc_src[lang] = src

if DRY:
    print('(dry) rien d\'écrit')
else:
    for f in FILES:
        open(f'{ROOT}/src/data/{f}.ts', 'w', encoding='utf-8').write(data_src[f])
    for lang in LANGS:
        open(f'{ROOT}/src/i18n/locales/help/{lang}.ts', 'w', encoding='utf-8').write(loc_src[lang])
    with open(os.path.join(SRC, 'pending-captures.json'), 'w', encoding='utf-8') as fh:
        json.dump(captures, fh, ensure_ascii=False, indent=2)
    print(f'écrit : {len(dead_keys)} clés retirées, {len(new_keys["fr"])} clés écrites par langue, {len(captures)} captures à prendre')
