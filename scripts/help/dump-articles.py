#!/usr/bin/env python3
"""Exporte chaque article du mode d'emploi en JSON (3 langues) pour réécriture.

  python3 scripts/help/dump-articles.py <dossier de sortie>

Un fichier par article : <sortie>/<dataFile>/<id>.json avec titre, description,
mots-clés, lien d'action, sections (clé, type, capture, heading/body en/fr/es).
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1]
FILES = ('ownerHelpContent', 'organizerHelpContent', 'agencyHelpContent')
LANGS = ('en', 'fr', 'es')

def load_locale(lang):
    src = open(f'{ROOT}/src/i18n/locales/help/{lang}.ts', encoding='utf-8').read()
    d = {}
    for m in re.finditer(r"""^\s*["'](ohelp\.[^"']+)["']:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),?\s*$""", src, re.M):
        raw = m.group(2)
        if raw[0] == '"':
            val = json.loads(raw)
        else:
            val = raw[1:-1].replace("\\'", "'").replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
        d[m.group(1)] = val
    return d

MAIN = {}
for lang in LANGS:
    src = open(f'{ROOT}/src/i18n/locales/{lang}.ts', encoding='utf-8').read()
    m = {}
    for mm in re.finditer(r"""^\s*["'](sidebar\.group\.[^"']+)["']:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),?\s*$""", src, re.M):
        raw = mm.group(2)
        m[mm.group(1)] = json.loads(raw) if raw[0] == '"' else raw[1:-1].replace("\\'", "'")
    MAIN[lang] = m

LOC = {lang: load_locale(lang) for lang in LANGS}

def tr(key):
    return {lang: LOC[lang].get(key) or MAIN[lang].get(key) or f'⟨{key}⟩' for lang in LANGS}

def parse_articles(src):
    out = []
    for cat in re.finditer(r"\n  \{\n    id: '([^']+)',\n    labelKey: '([^']+)',\n    icon: '([^']+)',\n    articles: \[(.*?)\n    \],\n  \},", src, re.S):
        cat_id, cat_label, _icon, body = cat.groups()
        for a in re.finditer(r"\n      \{\n        id: '([^']+)',(.*?)\n      \},", body, re.S):
            aid, abody = a.groups()
            def field(name):
                mm = re.search(rf"\n        {name}: '([^']+)'", abody)
                return mm.group(1) if mm else None
            secs = []
            for s in re.finditer(r"\{ headingKey: '([^']+)', bodyKey: '([^']+)'(.*?)\}", abody):
                hk, bk, rest = s.groups()
                t = re.search(r"type: '([a-z]+)'", rest)
                sh = re.search(r"screenshotUrl: '([^']+)'", rest)
                secs.append({'headingKey': hk, 'bodyKey': bk, 'type': t.group(1) if t else None, 'screenshotUrl': sh.group(1) if sh else None})
            link = re.search(r"actionLink: \{ labelKey: '([^']+)', path: '([^']+)' \}", abody)
            kw = re.search(r"keywords: \[(.*?)\]", abody, re.S)
            out.append({
                'id': aid, 'categoryId': cat_id, 'categoryLabel': tr(cat_label),
                'icon': field('icon'), 'titleKey': field('titleKey'), 'descKey': field('descKey'),
                'quickStart': 'quickStart: true' in abody,
                'relatedArticleIds': re.findall(r"'([^']+)'", (re.search(r"relatedArticleIds: \[(.*?)\]", abody) or [None, ''])[1]) if 'relatedArticleIds' in abody else [],
                'keywords': re.findall(r"'((?:[^'\\]|\\.)*)'", kw.group(1)) if kw else [],
                'actionLink': {'labelKey': link.group(1), 'label': tr(link.group(1)), 'path': link.group(2)} if link else None,
                'sections': secs,
            })
    return out

total = 0
for f in FILES:
    src = open(f'{ROOT}/src/data/{f}.ts', encoding='utf-8').read()
    os.makedirs(f'{OUT}/{f}', exist_ok=True)
    for art in parse_articles(src):
        ns = re.sub(r'\.s\d+h$', '', art['sections'][0]['headingKey']) if art['sections'] else art['titleKey'].rsplit('.', 1)[0]
        doc = {
            'file': f, 'id': art['id'], 'ns': ns, 'categoryId': art['categoryId'], 'categoryLabel': art['categoryLabel'],
            'icon': art['icon'], 'quickStart': art['quickStart'], 'relatedArticleIds': art['relatedArticleIds'],
            'titleKey': art['titleKey'], 'descKey': art['descKey'],
            'title': tr(art['titleKey']), 'desc': tr(art['descKey']), 'keywords': art['keywords'],
            'actionLink': art['actionLink'],
            'sections': [
                {'headingKey': s['headingKey'], 'bodyKey': s['bodyKey'], 'type': s['type'], 'screenshotUrl': s['screenshotUrl'],
                 'heading': tr(s['headingKey']), 'body': tr(s['bodyKey'])}
                for s in art['sections']
            ],
        }
        with open(f'{OUT}/{f}/{art["id"]}.json', 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
        total += 1
print(f'{total} articles exportés dans {OUT}')
