#!/usr/bin/env python3
"""`deno check` des edge functions, là où esm.sh et deno.land sont bloqués
(sessions Claude Code dans le cloud : le proxy refuse les deux hôtes).

  python3 scripts/deno-check-edge.py                  # toutes les fonctions
  python3 scripts/deno-check-edge.py send-missed-you create-checkout

Une carte d'import (générée, jamais committée) pointe chaque import distant
vers la même version ailleurs : esm.sh/<pkg>@<v> → npm:<pkg>@<v>,
deno.land/std et deno.land/x/imagescript → raw.githubusercontent.com (même
tag). Stripe demande un pas de plus : Deno prend l'export « deno » du paquet,
du JS sans types, et `new Stripe()` tombait en `any` (club-subscription
échouait, et aucune ligne Stripe n'était vérifiée). Ses 283 fichiers
`declare module 'stripe' {…}` sont donc réunis en UN module, servi par
`@ts-types` — les mêmes types qu'esm.sh.

Fonctions vérifiées UNE à la fois, sous `nice` (des vérifs en parallèle ont
fait tomber le Mac de Paul le 30/09). Deno absent : `npm i --prefix /tmp/deno
deno` puis ajouter `/tmp/deno/node_modules/.bin` au PATH.

Né le 2026-09-30 : c'est ce banc qui a trouvé les deux faux clients
structurels (wallet, loadOptIns) derrière les « excessively deep » de
send-ticket-confirmation, send-vip-confirmation et send-missed-you.
"""
import json, os, re, subprocess, sys, tempfile

ROOT = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
FN_DIR = os.path.join(ROOT, 'supabase', 'functions')
WORK = os.path.join(tempfile.gettempdir(), 'yuno-deno-check')
ENV = {**os.environ, 'DENO_NO_PACKAGE_JSON': '1'}
if os.path.exists('/root/.ccr/ca-bundle.crt'):
    ENV.setdefault('DENO_CERT', '/root/.ccr/ca-bundle.crt')

REMOTE = re.compile(r"""['"](https://(?:esm\.sh|deno\.land)/[^'"]+)['"]""")
ESM = re.compile(r'^https://esm\.sh/((?:@[^/@]+/)?[^/@]+)@([^/]+)$')


def sources():
    for root, _, files in os.walk(FN_DIR):
        for f in files:
            if f.endswith('.ts'):
                yield os.path.join(root, f)


def stripe_shim(version):
    """Types de stripe@<version> réunis en un module + shim @ts-types."""
    subprocess.run(['deno', 'cache', '--quiet', f'npm:stripe@{version}'], env=ENV, check=True,
                   cwd=WORK, capture_output=True)
    info = json.loads(subprocess.check_output(['deno', 'info', '--json'], env=ENV, text=True))
    types = os.path.join(info['npmCache'], 'registry.npmjs.org', 'stripe', version, 'types')
    files = sorted((os.path.join(r, f) for r, _, fs in os.walk(types) for f in fs if f.endswith('.d.ts')),
                   key=lambda p: (not p.endswith(os.sep + 'index.d.ts') or os.path.dirname(p) != types, p))
    out = ["import {Agent, IncomingMessage} from 'node:http';"]
    for path in files:
        lines = open(path, encoding='utf-8').read().split('\n')
        start = next(i for i, l in enumerate(lines) if l.startswith("declare module 'stripe' {"))
        end = max(i for i, l in enumerate(lines) if l.rstrip() == '}')
        # Dans un module, un namespace fusionné doit être exporté partout.
        out += [re.sub(r'^  namespace ', '  export namespace ', l) for l in lines[start + 1:end]]
    d = os.path.join(WORK, f'stripe-{version}')
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'stripe.d.ts'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    shim = os.path.join(d, 'shim.ts')
    open(shim, 'w', encoding='utf-8').write(
        f'// @ts-types="./stripe.d.ts"\nimport Stripe from "npm:stripe@{version}";\nexport default Stripe;\n')
    return 'file://' + shim


def import_map():
    urls = set()
    for path in sources():
        urls.update(REMOTE.findall(open(path, encoding='utf-8').read()))
    imports = {}
    for url in sorted(urls):
        m = ESM.match(url.split('?')[0])
        if m and m.group(1) == 'stripe':
            imports[url] = stripe_shim(m.group(2))
        elif m:
            imports[url] = f'npm:{m.group(1)}@{m.group(2)}'
        elif (m := re.match(r'^https://deno\.land/std@([^/]+)/', url)):
            imports[f'https://deno.land/std@{m.group(1)}/'] = \
                f'https://raw.githubusercontent.com/denoland/deno_std/{m.group(1)}/'
        elif (m := re.match(r'^https://deno\.land/x/imagescript@([^/]+)/', url)):
            imports[f'https://deno.land/x/imagescript@{m.group(1)}/'] = \
                f'https://raw.githubusercontent.com/matmen/ImageScript/{m.group(1)}/'
        else:
            sys.exit(f'import distant sans correspondance : {url}')
    path = os.path.join(WORK, 'import_map.json')
    json.dump({'imports': imports}, open(path, 'w'), indent=2)
    return path


def main():
    os.makedirs(WORK, exist_ok=True)
    names = sys.argv[1:] or sorted(n for n in os.listdir(FN_DIR)
                                   if n != '_shared' and os.path.exists(os.path.join(FN_DIR, n, 'index.ts')))
    imap = import_map()
    failed = []
    for name in names:
        r = subprocess.run(['nice', '-n', '10', 'deno', 'check', f'--import-map={imap}',
                            os.path.join(FN_DIR, name, 'index.ts')],
                           env=ENV, capture_output=True, text=True)
        if r.returncode == 0:
            print(f'OK    {name}', flush=True)
        else:
            errors = len(re.findall(r'\[ERROR\]', r.stdout + r.stderr))
            print(f'FAIL  {name} ({errors})', flush=True)
            print(re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr).rstrip(), flush=True)
            failed.append(name)
    print(f'\n{len(names) - len(failed)}/{len(names)} OK' + (f' — échecs : {", ".join(failed)}' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
