import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { motion } from "framer-motion";

/**
 * SalesforceSignup
 * ----------------
 * AppExchange post-install setup. Salesforce doesn't redirect with a token
 * (unlike Microsoft and AWS). Customer installs the SyncAI managed package,
 * then visits this page to verify the LMA license sync is wired up. The
 * actual lifecycle (Active / Trial / Suspended / etc.) flows asynchronously
 * via the customer's Salesforce Flow → marketplace-salesforce-license
 * Edge Function.
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
        className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm"
      >
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
              Welcome from Salesforce AppExchange
            </h2>
            <p className="text-[#9BA7B4]">
              The SyncAI managed package is installed in your Salesforce org.
              Three steps to complete activation.
            </p>
          </div>

          {orgId && (
            <div className="bg-[#0B0F14] border border-[#232A33] rounded-lg p-6">
              <p className="text-xs text-[#9BA7B4] mb-3 uppercase tracking-wide">
                Salesforce Org
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Org ID</p>
                  <p className="text-xs font-mono text-[#E6EDF3]">{orgId}</p>
                </div>
                {packageVersion && (
                  <div>
                    <p className="text-xs text-[#9BA7B4] mb-1">
                      Package version
                    </p>
                    <p className="text-xs font-mono text-[#E6EDF3]">
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
              body="Grant the SyncAI Integration User read+write on Asset, WorkOrder, MaintenanceWorkRule. A permission set ships with the package."
            />
            <SetupStep
              number={2}
              title="Activate the LMA license flow"
              body="A pre-built Flow on the License object posts lifecycle changes (Active / Suspended / etc.) to our license-event webhook."
            />
            <SetupStep
              number={3}
              title="Connect your Anthropic key"
              body="After signup, add Anthropic in Integrations to activate all 15 AI agents for your SF org."
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

          <p className="text-xs text-[#9BA7B4] text-center">
            License records in LMA sync to SyncAI within 5 minutes of
            activation.
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
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#00A1E0]/15 text-[#00A1E0] text-sm font-bold flex items-center justify-center">
        {number}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-[#E6EDF3] mb-0.5">{title}</p>
        <p className="text-xs text-[#9BA7B4] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

export default SalesforceSignup;
