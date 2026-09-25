#!/usr/bin/env python3
"""Rejoue chaque `.from('t').select('…')` statique du code contre PostgREST
(service role, `limit=0` : aucune ligne lue) et liste ceux que la base refuse
— colonne disparue, table absente, jointure ambiguë (PGRST201).

  . scripts/ci-web-env.sh && SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/check-selects.py

Né le 2026-09-25 : 20 requêtes cassées en silence, dont 9 par `venues(…)`
embarqué depuis `events` (deux clés vers `venues` depuis `partner_venue_id` :
écrire `venues!events_venue_id_fkey(…)`). Les sélections à `${…}` ne sont pas
vérifiées.
"""
import re,subprocess,os,sys,urllib.request,urllib.parse
from concurrent.futures import ThreadPoolExecutor
files=subprocess.check_output(['git','ls-files','src','supabase/functions']).decode().split()
pat=re.compile(r"""from\(\s*['"]([a-z_0-9]+)['"]\s*\)\s*\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")""",re.S)
url=os.environ['VITE_SUPABASE_URL']; key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
seen={}
for f in files:
    if not f.endswith(('.ts','.tsx')) or '__tests__' in f: continue
    s=open(f).read()
    for m in pat.finditer(s):
        t,sel=m.group(1),m.group(2)[1:-1]
        if '${' in sel: continue
        sel=re.sub(r'\s+','',sel)
        if sel in ('*',''): continue
        seen.setdefault((t,sel),[]).append(f"{f}:{s[:m.start()].count(chr(10))+1}")
def chk(item):
    (t,sel),locs=item
    q=f"{url}/rest/v1/{t}?select={urllib.parse.quote(sel,safe=',()!:*.')}&limit=0"
    req=urllib.request.Request(q,headers={'apikey':key,'Authorization':'Bearer '+key})
    try: urllib.request.urlopen(req,timeout=40).read(); return None
    except urllib.error.HTTPError as e: return (t,sel,e.read().decode()[:260],locs)
    except Exception as e: return (t,sel,'NET '+str(e),locs)
with ThreadPoolExecutor(8) as ex: res=[r for r in ex.map(chk,seen.items()) if r]
for t,sel,b,locs in res:
    print(f"### {t}  {sel[:140]}\n   {b}\n   "+"\n   ".join(locs))
print(f"TOTAL checked {len(seen)} bad {len(res)}")
