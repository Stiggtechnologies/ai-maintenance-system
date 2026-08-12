SYSTEM = ["GROUND ENGAGING TOOL","HYDRAULIC SYSTEM","ENGINE GROUP","UNDERCARRIAGE","TRANSMISSION GROUP",
"CAB GROUP","LOW VOLTAGE ELECTRIC","STEERING SYSTEM","BRAKE SYSTEM","TIRES/RIMS","ATTACHMENTS",
"AIR CONDITIONING SYS","CIRCLE DRIVE SYSTEM","LUBE SYSTEM","FUEL SYSTEM","FIRE SUPPRESSION SYS",
"ROTATING FRAME","BUCKET/STICK GROUP","FRAME GROUP","DIFFERENTIAL GROUP","FINAL DRIVE GROUP",
"LIGHTING-ELECTRICAL","AIR SYSTEM","BOOM GROUP","PROPEL MACHINERY","GLASS/WINDSHIELD","24 VOLT SYSTEM",
"HIGH VOLTAGE ELECTRI","SWING MACHINERY","CONTROL GROUP-ELECTR","CARBODY","HOIST MACHINERY",
"PUMP DRIVE GROUP","DUMP BODY GROUP","FRONT WHEEL STRUT GR","REAR WHEEL STRUT GRO","MAIN GENERATOR",
"GENSET AUX POWER","DIPPER TRIP SYSTEM","ALARM SYSTEM","ICE LUGS"]
ACTIVITY = ["INSPECTION/TROUBLESH","PLANNED MAINTENANCE","CONTRACTOR INSPECTIO","MIDLIFE","OIL SAMPLES",
"STEAMING","TOP UP OILS/GREASE","TIRE INSPECTION/AIR","RELOCATE - MAINTENAN","MEM VENDOR TRAINING",
"HEIGHT RELATED MAINT","PLANNED OVERHAUL","PLANNED STEAMING","INCIDENT INSPECTION","PLANNED SERVICE/INSP",
"UNDERCARRIAGE INSPEC","BRAKE TESTING","OPPORTUNE MAINTENANC","PLANNED TIRES","WELDING","CONTRACTOR",
"RADIO TECH","ASSISTING MEM","BREAK IN WORK","TOWING/TRANSPORT - M"]
DELAY = ["WAIT PARTS","WAIT TOWING/TRANSPOR","WAIT SHOP SPACE","WAIT LABOUR","WAIT CONTRACTOR",
"WAIT PARTS - FINNING","WAIT STEAM BAY","WAIT TIRE SHOP SPACE","OUT OF FUEL","INCIDENT",
"HEIGHT RELATED DOWN","ELECTRICAL TRIP","OPERATIONS EQUIPMENT"]
KIND = {}
for x in SYSTEM: KIND[x]="system_group"
for x in ACTIVITY: KIND[x]="activity_type"
for x in DELAY: KIND[x]="delay_reason"
# Planned down vs unplanned down, for the operating-state model.
PLANNED = set(ACTIVITY)
if __name__=="__main__":
    import csv, collections
    rows=list(csv.DictReader(open('vnc.csv')))
    seen=collections.Counter((r['reason'] or '').strip().upper() for r in rows)
    missing=[k for k in seen if k not in KIND]
    print(f"reason codes: {len(seen)}  classified: {len(KIND)}  UNCLASSIFIED: {missing}")
    by=collections.Counter(KIND.get(k,'?') for k in seen)
    print("distinct labels by kind:", dict(by))
    ev=collections.Counter()
    for r in rows: ev[KIND.get((r['reason'] or '').strip().upper(),'?')]+=1
    print("events by kind:", dict(ev))
    delayh=sum(float(r['duration'] or 0) for r in rows if KIND.get((r['reason'] or '').strip().upper())=='delay_reason')
    print(f"delay hours: {delayh:,.0f}")
