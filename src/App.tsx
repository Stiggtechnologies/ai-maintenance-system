import { useCallback, useEffect, useRef, useState } from "react";
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
import { RecoveryAwarePage } from "./components/RecoveryAwarePage";
import { AssetDetailPage } from "./pages/AssetDetailPage";
import { AssessmentsPage } from "./pages/AssessmentsPage";
import { AssessmentHomePage } from "./pages/AssessmentHomePage";
import { AssetManagement } from "./components/AssetManagement";
import { MissionControl } from "./pages/MissionControl";
import { WorkActionBoard } from "./pages/WorkActionBoard";
import NotificationScreening from "./pages/NotificationScreening";
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
import { LearningLoop } from "./pages/LearningLoop";
import { Reliability } from "./pages/ReliabilityPage";
import { ReadinessPage } from "./pages/ReadinessPage";
import { OperationalBriefing } from "./pages/OperationalBriefing";
import { AssetOntologyPage } from "./pages/AssetOntologyPage";
import { AssetTwinsPage } from "./pages/AssetTwinsPage";
import { LifecyclePositionPage } from "./pages/LifecyclePositionPage";
import { ReliabilityByDesignPage } from "./pages/ReliabilityByDesignPage";
import { LifecycleDecisionsPage } from "./pages/LifecycleDecisionsPage";
import { IntervalDecisionsPage } from "./pages/IntervalDecisionsPage";
import { JobPlansPage } from "./pages/JobPlansPage";
import { PmProgrammePage } from "./pages/PmProgrammePage";
import { SchedulingPage } from "./pages/SchedulingPage";
import SyncRecoveryPage from "./pages/SyncRecoveryPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { HandoverPage } from "./pages/HandoverPage";
import { TurnaroundsPage } from "./pages/TurnaroundsPage";
import { AssetOnboardingHub } from "./pages/AssetOnboardingHub";
import { SecurityAuditLog } from "./pages/SecurityAuditLog";
import { PilotLeads } from "./pages/PilotLeads";
import { ExecutiveIntelligence } from "./pages/ExecutiveIntelligence";
import { IntegrationHealthPanel } from "./pages/IntegrationHealthPanel";
import { ValueRealization } from "./pages/ValueRealization";
import { EmergencyMode } from "./pages/EmergencyMode";
import { PlaybooksLibrary } from "./pages/PlaybooksLibrary";
import { TrustExplainability } from "./pages/TrustExplainability";
import { BenchmarkingPanel } from "./pages/BenchmarkingPanel";
import { AutonomyMaturity } from "./pages/AutonomyMaturity";
import { SetupWizard } from "./pages/SetupWizard";
import { ArtifactWorkspace } from "./pages/ArtifactWorkspace";
import { ApprovalQueue } from "./components/ApprovalQueue";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { useAuth } from "./components/AuthProvider";
import { getRoleHome } from "./lib/roleNavigation";
import { ReliabilityCopilotPage } from "./pages/ReliabilityCopilotPage";
import { FirstCustomerPilotPage } from "./pages/FirstCustomerPilotPage";
import { DecisionCaseWorkspacePage } from "./pages/DecisionCaseWorkspacePage";
import {
  clearDecisionCaseHandoff,
  readDecisionCaseHandoff,
} from "./lib/decision-case";
import { createPersistedDecisionCase } from "./services/decisionCaseService";

type Page =
  | "demo"
  | "signin"
  | "signup"
  | "enterprise"
  | "app"
  | "security"
  | "privacy"
  | "terms";

function PublicCopilotExperience() {
  useEffect(() => {
    document.title = "SyncAI | Governed Engineering Intelligence";
  }, []);

  return <DecisionCaseWorkspacePage publicMode />;
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const destination = new URL(value, window.location.origin);
    if (
      destination.origin !== window.location.origin ||
      destination.pathname === "/signin"
    ) {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

function AuthenticatedSignInTransition({
  complete,
}: {
  complete: () => void | Promise<void>;
}) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void complete();
  }, [complete]);
  return <LoadingScreen />;
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    return requested === "signin" ||
      requested === "signup" ||
      requested === "enterprise"
      ? requested
      : "demo";
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [signInApproved, setSignInApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const signInTransition = useRef<Promise<void> | null>(null);
  const signInParams = new URLSearchParams(window.location.search);
  const signInReturnTo = safeReturnTo(signInParams.get("returnTo"));
  const isPasswordRecovery = signInParams.get("mode") === "recovery";

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setIsAuthenticated(!!session);
        if (session) {
          setCurrentPage("app");
          setSignInApproved(true);
        }
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
      else {
        setCurrentPage("demo");
        setSignInApproved(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
    setSignInApproved(true);
    setCurrentPage("app");
  };

  const handleSignInSuccess = useCallback(() => {
    if (signInTransition.current) return signInTransition.current;
    const transition = (async () => {
      setIsAuthenticated(true);
      setSignInApproved(true);
      setCurrentPage("app");
      const handoff = readDecisionCaseHandoff(window.sessionStorage);
      if (handoff) {
        try {
          const secured = await createPersistedDecisionCase(
            handoff.decisionCase,
            {
              asset: handoff.decisionCase.asset,
              role: handoff.decisionCase.intakeRole,
              company: handoff.decisionCase.organization,
              intakeId: "public-decision-case-handoff",
            },
          );
          clearDecisionCaseHandoff(window.sessionStorage);
          window.location.assign(`/decision-cases/${secured.id}`);
          return;
        } catch {
          // Keep the staged case in this tab so a transient sync failure can be
          // retried without losing the public Decision Case.
        }
      }
      window.location.assign(signInReturnTo);
    })();
    signInTransition.current = transition;
    return transition;
  }, [signInReturnTo]);

  if (loading) return <LoadingScreen />;

  const pageTransition = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.15 },
  };

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/marketplace/signup" element={<MarketplaceSignup />} />
          <Route path="/marketplace/aws/signup" element={<AwsMarketplaceSignup />} />
          <Route path="/marketplace/salesforce/signup" element={<SalesforceSignup />} />
          <Route path="/auth/callback/azure" element={<AzureADCallback />} />
          <Route
            path="/signin"
            element={
              isAuthenticated && signInApproved && !isPasswordRecovery ? (
                <AuthenticatedSignInTransition complete={handleSignInSuccess} />
              ) : (
                <Login
                  onSuccess={handleSignInSuccess}
                  onTabChange={(page) => window.location.assign(`/?view=${page}`)}
                />
              )
            }
          />
          <Route path="/setup" element={<FirstCustomerPilotPage />} />
          <Route path="/pilot/reliability" element={<FirstCustomerPilotPage />} />
          <Route path="/demo/copilot" element={<PublicCopilotExperience />} />
          <Route path="/workspace/cases/:caseId" element={<DecisionCaseWorkspacePage publicMode />} />
          <Route
            path="/*"
            element={
              <AnimatePresence mode="wait">
                {currentPage === "demo" && !isAuthenticated && (
                  <motion.div key="demo" {...pageTransition}>
                    <PublicCopilotExperience />
                  </motion.div>
                )}
                {currentPage === "signin" && (
                  <motion.div key="signin" {...pageTransition}>
                    <Login onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
                  </motion.div>
                )}
                {currentPage === "signup" && (
                  <motion.div key="signup" {...pageTransition}>
                    <Signup onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
                  </motion.div>
                )}
                {currentPage === "enterprise" && (
                  <motion.div key="enterprise" {...pageTransition}>
                    <EnterpriseAccess onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
                  </motion.div>
                )}
                {currentPage === "app" && isAuthenticated && (
                  <motion.div key="app" {...pageTransition} style={{ height: "100vh" }}>
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

function AdminGate({ children }: { children: React.ReactElement }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  const role = (profile?.role as string) ?? "";
  if (role !== "admin" && role !== "ai_admin") {
    return <Navigate to="/mission-control" replace />;
  }
  return children;
}

function AssessmentGate({ children }: { children: React.ReactElement }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  const role = (profile?.role as string) ?? "";
  const allowed = [
    "admin",
    "ai_admin",
    "reliability_engineer",
    "maintenance_manager",
    "planner",
    "assessment_sponsor",
  ];
  if (!allowed.includes(role)) {
    return <Navigate to="/mission-control" replace />;
  }
  return children;
}

function RoleLanding() {
  const { user, profile, loading } = useAuth();
  const [graceExpired, setGraceExpired] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGraceExpired(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);
  if (loading || (user && !profile && !graceExpired)) return null;
  return <Navigate to={getRoleHome(profile?.role as string)} replace />;
}

function AuthenticatedApp() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AppShell currentPath={location.pathname} onNavigate={(path) => navigate(path)}>
      <ErrorBoundary inline resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<RoleLanding />} />
          <Route path="/overview" element={<RoleLanding />} />

          <Route path="/mission-control" element={<RecoveryAwarePage surface="mission"><MissionControl /></RecoveryAwarePage>} />
          <Route path="/command-centers" element={<CommandCenters />} />
          <Route path="/readiness" element={<ReadinessPage />} />
          <Route path="/assessments" element={<AssessmentGate><AssessmentsPage /></AssessmentGate>} />
          <Route path="/assessments/:assessmentId" element={<AssessmentGate><AssessmentHomePage /></AssessmentGate>} />
          <Route path="/cowork" element={<Navigate to="/decision-cases/demo" replace />} />
          <Route path="/decision-cases/:caseId" element={<DecisionCaseWorkspacePage />} />

          <Route path="/ai-workforce" element={<AIWorkforce />} />
          <Route path="/autonomy" element={<Navigate to="/governance" replace />} />
          <Route path="/autonomy-maturity" element={<AutonomyMaturity />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/governance" element={<DecisionGovernance />} />

          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
          <Route path="/assets/ontology" element={<AssetOntologyPage />} />
          <Route path="/assets/twins" element={<AssetTwinsPage />} />
          <Route path="/assets" element={<AssetManagement />} />
          <Route path="/onboarding" element={<AssetOnboardingHub />} />
          <Route path="/reliability" element={<RecoveryAwarePage surface="reliability"><Reliability /></RecoveryAwarePage>} />
          <Route path="/reliability/intervals" element={<IntervalDecisionsPage />} />
          <Route path="/reliability-copilot" element={<ReliabilityCopilotPage />} />
          <Route path="/risk" element={<RiskConsequence />} />
          <Route path="/job-plans" element={<JobPlansPage />} />
          <Route path="/pm-programme" element={<PmProgrammePage />} />

          <Route path="/lifecycle" element={<LifecyclePositionPage />} />
          <Route path="/lifecycle/decisions" element={<LifecycleDecisionsPage />} />
          <Route path="/design" element={<ReliabilityByDesignPage />} />

          <Route path="/work/:workOrderId" element={<RecoveryAwarePage surface="work_order"><WorkOrderDetailPage /></RecoveryAwarePage>} />
          <Route path="/work" element={<WorkActionBoard />} />
          <Route path="/notifications" element={<NotificationScreening />} />
          <Route path="/scheduling" element={<SchedulingPage />} />
          <Route path="/recovery" element={<SyncRecoveryPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/handover" element={<HandoverPage />} />
          <Route path="/turnarounds" element={<TurnaroundsPage />} />
          <Route path="/briefing" element={<OperationalBriefing />} />

          <Route path="/executive" element={<ExecutiveIntelligence />} />
          <Route path="/performance" element={<Navigate to="/executive" replace />} />
          <Route path="/oee" element={<OEEDashboard />} />
          <Route path="/learning-loop" element={<RecoveryAwarePage surface="learning"><LearningLoop /></RecoveryAwarePage>} />
          <Route path="/value" element={<RecoveryAwarePage surface="value"><ValueRealization /></RecoveryAwarePage>} />
          <Route path="/benchmarking" element={<BenchmarkingPanel />} />
          <Route path="/trust" element={<TrustExplainability />} />

          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/integration-health" element={<IntegrationHealthPanel />} />
          <Route path="/playbooks" element={<PlaybooksLibrary />} />
          <Route path="/emergency" element={<EmergencyMode />} />
          <Route path="/artifacts" element={<ArtifactWorkspace />} />
          <Route path="/setup" element={<AdminGate><SetupWizard /></AdminGate>} />
          <Route path="/research" element={<AdminGate><ResearchDashboard /></AdminGate>} />
          <Route path="/runs" element={<AdminGate><RunsAuditPage /></AdminGate>} />
          <Route path="/deployments/new/configure" element={<AdminGate><DeploymentConfiguratorPage /></AdminGate>} />
          <Route path="/deployments/new" element={<AdminGate><TemplateSelectorPage /></AdminGate>} />
          <Route path="/deployments" element={<AdminGate><TemplateSelectorPage /></AdminGate>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/security-log" element={<AdminGate><SecurityAuditLog /></AdminGate>} />
          <Route path="/pilot-leads" element={<AdminGate><PilotLeads /></AdminGate>} />

          <Route path="*" element={<Navigate to="/mission-control" replace />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

export default App;