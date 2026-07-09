import { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { supabase } from "./lib/supabase";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { EnterpriseAccess } from "./pages/EnterpriseAccess";
import { MarketplaceSignup } from "./pages/MarketplaceSignup";
import { AzureADCallback } from "./pages/AzureADCallback";
import { AwsMarketplaceSignup } from "./pages/AwsMarketplaceSignup";
import { SalesforceSignup } from "./pages/SalesforceSignup";
import { LoadingScreen } from "./components/LoadingScreen";
import { Security } from "./pages/Security";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { AppShell } from "./components/AppShell";
import { AssetDetailPage } from "./pages/AssetDetailPage";
import { AssetManagement } from "./components/AssetManagement";
import { MissionControl } from "./pages/MissionControl";
import { PerformanceDashboard } from "./pages/PerformanceDashboard";
import { WorkActionBoard } from "./pages/WorkActionBoard";
import { DecisionGovernance } from "./pages/DecisionGovernance";
import { RunsAuditPage } from "./pages/RunsAuditPage";
import { ResearchDashboard } from "./pages/ResearchDashboard";
import { WorkOrderDetailPage } from "./pages/WorkOrderDetailPage";
import { OEEDashboard } from "./pages/OEEDashboard";
import { SettingsPage } from "./pages/SettingsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { TemplateSelectorPage } from "./pages/TemplateSelectorPage";
import { DeploymentConfiguratorPage } from "./pages/DeploymentConfiguratorPage";
import { AIWorkforce } from "./pages/AIWorkforcePage";
import { CommandCenters } from "./pages/CommandCenters";
import { RiskConsequence } from "./pages/RiskConsequence";
import { ScenarioSimulator } from "./pages/ScenarioSimulator";
import { LearningLoop } from "./pages/LearningLoop";
import { Reliability } from "./pages/ReliabilityPage";
import { ReadinessPage } from "./pages/ReadinessPage";
import { OperationalBriefing } from "./pages/OperationalBriefing";
import { AssetIntelligencePage } from "./pages/AssetIntelligencePage";
import { AssetOnboardingHub } from "./pages/AssetOnboardingHub";
import { ExecutiveIntelligence } from "./pages/ExecutiveIntelligence";
import { IntegrationHealthPanel } from "./pages/IntegrationHealthPanel";
import { CoworkStudio } from "./pages/CoworkStudio";
import { ValueRealization } from "./pages/ValueRealization";
import { EmergencyMode } from "./pages/EmergencyMode";
import { PlaybooksLibrary } from "./pages/PlaybooksLibrary";
import { TrustExplainability } from "./pages/TrustExplainability";
import { BenchmarkingPanel } from "./pages/BenchmarkingPanel";
import { AutonomyMaturity } from "./pages/AutonomyMaturity";
import { SetupWizard } from "./pages/SetupWizard";
import { ArtifactWorkspace } from "./pages/ArtifactWorkspace";
import { AutonomyControlPanel } from "./components/AutonomyControlPanel";
import { ApprovalQueue } from "./components/ApprovalQueue";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { useAuth } from "./components/AuthProvider";
import { ReliabilityCopilotPage } from "./pages/ReliabilityCopilotPage";
import { FirstCustomerPilotPage } from "./pages/FirstCustomerPilotPage";

type Page =
  | "signin"
  | "signup"
  | "enterprise"
  | "app"
  | "pricing"
  | "security"
  | "privacy"
  | "terms";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("signin");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setIsAuthenticated(!!session);
        if (session) setCurrentPage("app");
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (session) setCurrentPage("app");
      else setCurrentPage("signin");
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
    setCurrentPage("app");
  };

  if (loading) return <LoadingScreen />;

  const pageTransition = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.15 },
  };

  return (
    // reducedMotion="user" honours prefers-reduced-motion across every
    // framer-motion animation in the app (WCAG 2.3.3 / Apple-MD guidance).
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/marketplace/signup" element={<MarketplaceSignup />} />
          <Route
            path="/marketplace/aws/signup"
            element={<AwsMarketplaceSignup />}
          />
          <Route
            path="/marketplace/salesforce/signup"
            element={<SalesforceSignup />}
          />
          <Route path="/auth/callback/azure" element={<AzureADCallback />} />
          <Route
            path="/pilot/reliability"
            element={<FirstCustomerPilotPage />}
          />
          <Route
            path="/demo/copilot"
            element={
              <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900">
                <ReliabilityCopilotPage />
              </div>
            }
          />
          <Route
            path="/*"
            element={
              <AnimatePresence mode="wait">
                {currentPage === "signin" && (
                  <motion.div key="signin" {...pageTransition}>
                    <Login
                      onSuccess={handleAuthSuccess}
                      onTabChange={setCurrentPage}
                    />
                  </motion.div>
                )}
                {currentPage === "signup" && (
                  <motion.div key="signup" {...pageTransition}>
                    <Signup
                      onSuccess={handleAuthSuccess}
                      onTabChange={setCurrentPage}
                    />
                  </motion.div>
                )}
                {currentPage === "enterprise" && (
                  <motion.div key="enterprise" {...pageTransition}>
                    <EnterpriseAccess
                      onSuccess={handleAuthSuccess}
                      onTabChange={setCurrentPage}
                    />
                  </motion.div>
                )}
                {currentPage === "app" && isAuthenticated && (
                  <motion.div
                    key="app"
                    {...pageTransition}
                    style={{ height: "100vh" }}
                  >
                    <AuthenticatedApp />
                  </motion.div>
                )}
                {currentPage === "security" && (
                  <motion.div key="security" {...pageTransition}>
                    <Security onNavigate={setCurrentPage} />
                  </motion.div>
                )}
                {currentPage === "privacy" && (
                  <motion.div key="privacy" {...pageTransition}>
                    <Privacy onNavigate={setCurrentPage} />
                  </motion.div>
                )}
                {currentPage === "terms" && (
                  <motion.div key="terms" {...pageTransition}>
                    <Terms onNavigate={setCurrentPage} />
                  </motion.div>
                )}
              </AnimatePresence>
            }
          />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}

/**
 * Internal/experimental surfaces (research orchestrator, run traces, deployment
 * configurator, setup wizard) are hidden from pilot roles — they are platform
 * admin tooling, not buyer-facing product. Everyone else lands on Mission
 * Control.
 */
function AdminGate({ children }: { children: React.ReactElement }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  const role = (profile?.role as string) ?? "";
  if (role !== "admin" && role !== "ai_admin") {
    return <Navigate to="/mission-control" replace />;
  }
  return children;
}

function AuthenticatedApp() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AppShell
      currentPath={location.pathname}
      onNavigate={(path) => navigate(path)}
    >
      <ErrorBoundary inline resetKey={location.pathname}>
        <Routes>
          {/* Default Ã¢ÂÂ Mission Control */}
          <Route
            path="/"
            element={<Navigate to="/mission-control" replace />}
          />
          <Route
            path="/overview"
            element={<Navigate to="/mission-control" replace />}
          />

          {/* Mission layer */}
          <Route path="/mission-control" element={<MissionControl />} />
          <Route path="/command-centers" element={<CommandCenters />} />
          <Route path="/readiness" element={<ReadinessPage />} />
          <Route path="/cowork" element={<CoworkStudio />} />

          {/* AI Workforce layer */}
          <Route path="/ai-workforce" element={<AIWorkforce />} />
          <Route path="/autonomy" element={<AutonomyControlPanel />} />
          <Route path="/autonomy-maturity" element={<AutonomyMaturity />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/governance" element={<DecisionGovernance />} />

          {/* Asset Intelligence */}
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
          <Route
            path="/assets/intelligence"
            element={<AssetIntelligencePage />}
          />
          <Route path="/assets" element={<AssetManagement />} />
          <Route path="/onboarding" element={<AssetOnboardingHub />} />
          <Route path="/reliability" element={<Reliability />} />
          <Route path="/risk" element={<RiskConsequence />} />

          {/* Work & Execution */}
          <Route path="/work/:workOrderId" element={<WorkOrderDetailPage />} />
          <Route path="/work" element={<WorkActionBoard />} />
          <Route path="/scenarios" element={<ScenarioSimulator />} />
          <Route path="/briefing" element={<OperationalBriefing />} />

          {/* Performance */}
          <Route path="/executive" element={<ExecutiveIntelligence />} />
          <Route path="/performance" element={<PerformanceDashboard />} />
          <Route path="/oee" element={<OEEDashboard />} />
          <Route path="/learning-loop" element={<LearningLoop />} />
          <Route path="/value" element={<ValueRealization />} />
          <Route path="/benchmarking" element={<BenchmarkingPanel />} />
          <Route path="/trust" element={<TrustExplainability />} />

          {/* System */}
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route
            path="/integration-health"
            element={<IntegrationHealthPanel />}
          />
          <Route path="/playbooks" element={<PlaybooksLibrary />} />
          <Route path="/emergency" element={<EmergencyMode />} />
          <Route path="/artifacts" element={<ArtifactWorkspace />} />
          <Route
            path="/setup"
            element={
              <AdminGate>
                <SetupWizard />
              </AdminGate>
            }
          />
          <Route
            path="/research"
            element={
              <AdminGate>
                <ResearchDashboard />
              </AdminGate>
            }
          />
          <Route
            path="/runs"
            element={
              <AdminGate>
                <RunsAuditPage />
              </AdminGate>
            }
          />
          <Route
            path="/deployments/new/configure"
            element={
              <AdminGate>
                <DeploymentConfiguratorPage />
              </AdminGate>
            }
          />
          <Route
            path="/deployments/new"
            element={
              <AdminGate>
                <TemplateSelectorPage />
              </AdminGate>
            }
          />
          <Route
            path="/deployments"
            element={
              <AdminGate>
                <TemplateSelectorPage />
              </AdminGate>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />

          <Route
            path="*"
            element={<Navigate to="/mission-control" replace />}
          />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

export default App;
