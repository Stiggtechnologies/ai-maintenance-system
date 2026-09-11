import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const migration=readFileSync("supabase/migrations/20261219137000_failure_coding_workflow.sql","utf8");
const panel=readFileSync("src/components/FailureCoding.tsx","utf8");
describe("failure coding workflow contract",()=>{
  it("terminates every PL/pgSQL function body",()=>{
    expect(migration.match(/end;\n\$\$;/g)).toHaveLength(4);
    expect(migration).not.toMatch(/end\s+\$\$;/);
  });
  it("protects mechanism provenance from broad work-order updates",()=>{
    expect(migration).toContain("trg_protect_failure_mechanism_provenance");
    expect(migration).toContain("current_user = 'postgres'");
    expect(migration).toContain("before insert or update or delete");
    expect(migration).toContain("governed coded failure history cannot be deleted directly");
    expect(migration).toContain("new.asset_id,new.work_type,new.completed_at");
    expect(migration).toContain("revoke all on function public.protect_failure_mechanism_provenance()");
  });
  it("records an append-only, named-human coding receipt",()=>{
    expect(migration).toContain("failure_mechanism_coding_events");
    expect(migration).toContain("prior_mechanism_id");
    expect(migration).toContain("coded_by");
    expect(migration).toContain("length(btrim(p_note)),0)<10");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("v_role is null or v_role not in");
    expect(migration).not.toContain("'admin','ai_admin'");
    expect(migration).toContain("enforce_failure_coding_event_tenant");
    expect(migration).toContain("w.organization_id=new.organization_id");
    expect(migration).toContain("dm.organization_id=new.organization_id");
    expect(migration).toContain("up.organization_id=new.organization_id");
  });
  it("provides a tenant-scoped bounded queue and candidate shortlist",()=>{
    expect(migration).toContain("get_failure_coding_queue");
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("limit v_limit");
    expect(migration).toContain("public.system_group_candidates");
    expect(migration).toContain("allMechanisms");
    expect(migration).toContain("limit 25");
    expect(migration).toContain("limit 500");
    expect(migration).toContain("mechanismLibraryTotal");
  });
  it("is reachable as a human decision rather than an inferred assignment",()=>{
    expect(panel).toContain('supabase.rpc("get_failure_coding_queue"');
    expect(panel).toContain('supabase.rpc(\n      "code_failure_mechanism"');
    expect(panel).toContain("Record human coding");
    expect(panel).toContain("Candidate shortlist");
    expect(panel).toContain("Complete governed mechanism library");
  });
});
