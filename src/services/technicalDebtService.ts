import { supabase } from "../lib/supabase";

export interface TechnicalDebtItem { id:number; assetId:string; assetName:string; kind:string; description:string; reason:string; requiredRemovalBy:string; riskAssessmentRef:string; lifecycleCost:number|null; currency:string|null; costBasis:string|null; recordedBy:string; approvedBy:string|null; approvedAt:string|null; removedAt:string|null }
export interface TechnicalDebtRegister { items:TechnicalDebtItem[]; valuationStatus:string; unvaluedCount:number; note:string }

async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.rpc(name,args);
  if(error) throw new Error(error.message);
  return data as T;
}
export const getCaseTechnicalDebt=(caseId:string)=>rpc<TechnicalDebtRegister>("get_case_technical_debt",{p_case_id:caseId});
export const recordCaseTechnicalDebt=(caseId:string,debt:Record<string,unknown>)=>rpc<{id:number;status:string}>("record_case_technical_debt",{p_case_id:caseId,p_debt:debt});
export const approveCaseTechnicalDebt=(id:number,basis:string)=>rpc<{id:number;status:string}>("approve_case_technical_debt",{p_debt_id:id,p_basis:basis});
export async function listCaseTechnicalDebtAssets(caseId:string){
  const {data,error}=await supabase.from("development_case_assets").select("asset_id,assets(name)").eq("development_case_id",caseId);
  if(error) throw new Error(error.message);
  return (data??[]).map((row)=>({id:row.asset_id,name:(row.assets as unknown as {name:string}|null)?.name??row.asset_id}));
}
