import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { motion } from "framer-motion";

/**
 * SalesforceSignup
 * ----------------
 * AppExchange setup design. No released SyncAI managed package or verified LMA
 * license event is evidenced in the current production environment. Query
 * parameters are display context only and must never be treated as proof of an
 * install or entitlement.
 *
 * URL pattern:
 *   https://app.syncai.ca/marketplace/salesforce/signup?organization_id=00D...&package_version_id=04t...
 */

export function SalesforceSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [packageVersion, setPackageVersion] = useState<string | null>(null);

  useEffect(() => {
    setOrgId(searchParams.get("organization_id") ?? searchParams.get("orgId"));
    setPackageVersion(
      searchParams.get("package_version_id") ?? searchParams.get("pkg"),
    );
  }, [searchParams]);

  const handleContinueToSignup = () => {
    navigate("/?next=signup");
  };

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs"
      >
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-industrial-text mb-2">
              Welcome from Salesforce AppExchange
            </h2>
            <p className="text-industrial-muted">
              This is the planned setup path. A released package, verified
              license event, and production entitlement are required before
              activation can complete.
            </p>
          </div>

          {orgId && (
            <div className="bg-industrial-black border border-industrial-border rounded-lg p-6">
              <p className="text-xs text-industrial-muted mb-3 uppercase tracking-wide">
                Salesforce Org
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-industrial-muted mb-1">Org ID</p>
                  <p className="text-xs font-mono text-industrial-text">
                    {orgId}
                  </p>
                </div>
                {packageVersion && (
                  <div>
                    <p className="text-xs text-industrial-muted mb-1">
                      Package version
                    </p>
                    <p className="text-xs font-mono text-industrial-text">
                      {packageVersion}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <SetupStep
              number={1}
              title="Configure object permissions"
              body="A reviewed package must define the minimum object access required for the agreed integration scope. No released permission set is evidenced yet."
            />
            <SetupStep
              number={2}
              title="Activate the LMA license flow"
              body="A security-reviewed package must send authenticated lifecycle changes to the production license-event receiver. That receiver is not deployed today."
            />
            <SetupStep
              number={3}
              title="Complete governed SyncAI onboarding"
              body="After entitlement is verified, configure only the approved data, model, evidence, and human-authority scope for the customer organization."
            />
          </div>

          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            onClick={handleContinueToSignup}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 px-4 bg-[#00A1E0] hover:bg-[#0089BF] text-white font-medium rounded-lg transition-colors"
          >
            Continue to account setup
          </motion.button>

          <p className="text-xs text-industrial-muted text-center">
            This page does not prove that a Salesforce package is installed or
            that a license is active.
          </p>
        </div>
      </motion.div>
    </AuthShell>
  );
}

function SetupStep({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-[#00A1E0]/15 text-[#00A1E0] text-sm font-bold flex items-center justify-center">
        {number}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-industrial-text mb-0.5">
          {title}
        </p>
        <p className="text-xs text-industrial-muted leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

export default SalesforceSignup;
