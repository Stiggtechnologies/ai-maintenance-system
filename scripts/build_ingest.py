import csv, datetime, json, collections
from classify import KIND, PLANNED

EXPAND = {'Wheel Doz':'Wheel Dozer','Water Tru':'Water Truck','Support L':'Support Loader',
          'Support D':'Support Dozer','Transport':'Transporter'}

def ts(d,t):
    if not d: return None
    d=d.split(' ')[0]
    try: Y,M,D=[int(x) for x in d.split('-')]
    except: return None
    t=(t or '00:00:00').strip()
    try: h,mi,s=[int(float(x)) for x in t.split(':')]
    except: h,mi,s=0,0,0
    try: return datetime.datetime(Y,M,D,min(h,23),min(mi,59),min(s,59))
    except: return None

rows=list(csv.DictReader(open('vnc.csv')))
assets={}
events=[]
skipped=collections.Counter()
for i,r in enumerate(rows):
    etype=EXPAND.get(r['equipment'].strip(), r['equipment'].strip())
    unit=r['unit'].strip()
    if not unit: skipped['no_unit']+=1; continue
    s=ts(r['sdate'],r['stime']); e=ts(r['edate'],r['etime'])
    if s is None: skipped['no_start']+=1; continue
    try: dur=float(r['duration'])
    except: dur=None
    if e is None and dur is not None: e=s+datetime.timedelta(hours=dur)
    if e is None: skipped['no_end_no_duration']+=1; continue
    if e<=s: e=s+datetime.timedelta(minutes=1); skipped['zero_or_negative_window_extended']+=1
    if dur is None: dur=(e-s).total_seconds()/3600.0
    name=f"{etype} {unit}"
    assets[name]=etype
    reason=(r['reason'] or '').strip().upper()
    kind=KIND.get(reason,'unclassified')
    events.append(dict(idx=i+2, asset=name, cls=etype, start=s, end=e, dur=round(dur,2),
                       reason=reason, kind=kind, comment=(r['comment'] or '').strip()[:200],
                       state='down_planned' if reason in PLANNED else 'down_unplanned'))

print(f"assets={len(assets)} events={len(events)} skipped={dict(skipped)}")
print("classes:", dict(collections.Counter(assets.values())))
span=(min(e['start'] for e in events), max(e['end'] for e in events))
print("span:", span[0].date(), "->", span[1].date())
byk=collections.Counter(e['kind'] for e in events)
print("by kind:", dict(byk))
json.dump({'assets':assets,'n':len(events)}, open('summary.json','w'), indent=1)

def esc(s): return (s or '').replace("'","''")
# ---- assets ----
with open('01_assets.sql','w') as f:
    f.write("insert into sites (organization_id, name, location)\n"
            "select '11111111-1111-1111-1111-111111111111', 'Auxiliary Fleet — Alberta Oil Sands Surface Mine', 'Alberta, Canada'\n"
            "where not exists (select 1 from sites where name='Auxiliary Fleet — Alberta Oil Sands Surface Mine');\n\n")
    vals=[]
    for name,cls in sorted(assets.items()):
        crit = 'critical' if cls in ('Shovel','Dozer') else 'high' if cls in ('Grader','Support Loader') else 'medium'
        vals.append(f"('{esc(name)}','{esc(cls)}','{crit}')")
    f.write("insert into assets (organization_id, site_id, name, asset_class, criticality, status)\n"
            "select '11111111-1111-1111-1111-111111111111', s.id, v.n, v.c, v.k, 'operating'\n"
            "from (values\n" + ",\n".join(vals) + "\n) as v(n,c,k)\n"
            "cross join (select id from sites where name='Auxiliary Fleet — Alberta Oil Sands Surface Mine' limit 1) s\n"
            "where not exists (select 1 from assets a where a.name=v.n);\n")
print("wrote 01_assets.sql")

# ---- operating states + work orders, chunked ----
CH=1500
for part,(fname,builder) in enumerate([('states',None),('wos',None)]): pass
def chunks(lst,n):
    for i in range(0,len(lst),n): yield lst[i:i+n]

for ci,ch in enumerate(chunks(events,CH)):
    with open(f'02_states_{ci:02d}.sql','w') as f:
        vals=[]
        for e in ch:
            vals.append(f"('{esc(e['asset'])}','{e['state']}','{e['start']:%Y-%m-%d %H:%M:%S}',"
                        f"'{e['end']:%Y-%m-%d %H:%M:%S}','{esc(e['reason'])}','vnc-traxs','vnc-{e['idx']}')")
        f.write("insert into operating_states (organization_id, asset_id, state, started_at, ended_at, reason_code, source_system, external_id)\n"
                "select '11111111-1111-1111-1111-111111111111', a.id, v.st, v.s::timestamptz, v.e::timestamptz, v.rc, v.src, v.ext\n"
                "from (values\n" + ",\n".join(vals) + "\n) as v(an,st,s,e,rc,src,ext)\n"
                "join assets a on a.name=v.an\n"
                "on conflict do nothing;\n")
work=[e for e in events if e['kind'] in ('system_group','activity_type')]
for ci,ch in enumerate(chunks(work,CH)):
    with open(f'03_wos_{ci:02d}.sql','w') as f:
        vals=[]
        for e in ch:
            wt = 'preventive' if e['kind']=='activity_type' else 'corrective'
            title = esc((e['comment'] or e['reason'])[:120]) or esc(e['reason'])
            vals.append(f"('{esc(e['asset'])}','AUX-{e['idx']}','{title}','{wt}','{esc(e['reason'])}',"
                        f"{e['dur']},'{e['start']:%Y-%m-%d %H:%M:%S}','{e['end']:%Y-%m-%d %H:%M:%S}','vnc-traxs','vnc-{e['idx']}')")
        f.write("insert into work_orders (organization_id, asset_id, wo_number, title, work_type, actual_failure_mode,\n"
                "  downtime_hours, created_at, completed_at, source_system, external_id, status, priority)\n"
                "select '11111111-1111-1111-1111-111111111111', a.id, v.wn, v.t, v.wt, v.fm, v.d::numeric,\n"
                "  v.c::timestamptz, v.cp::timestamptz, v.src, v.ext, 'completed',\n"
                "  case when v.d::numeric >= 24 then 'high' else 'medium' end\n"
                "from (values\n" + ",\n".join(vals) + "\n) as v(an,wn,t,wt,fm,d,c,cp,src,ext)\n"
                "join assets a on a.name=v.an\n"
                "on conflict do nothing;\n")
print(f"wrote {len(list(chunks(events,CH)))} state files, {len(list(chunks(work,CH)))} wo files; work_orders={len(work)}")
