import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { EnterpriseAccess } from "./pages/EnterpriseAccess";
import { LoadingScreen } from "./components/LoadingScreen";
import { Pricing } from "./pages/Pricing";
import { Security } from "./pages/Security";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { AppShell } from "./components/AppShell";
import { AssetDetailPage } from "./pages/AssetDetailPage";
import { OverviewDashboard } from "./pages/OverviewDashboard";
import { PerformanceDashboard } from "./pages/PerformanceDashboard";
import { WorkDashboard } from "./pages/WorkDashboard";
import { GovernanceDashboard } from "./pages/GovernanceDashboard";
import { WorkOrderDetailPage } from "./pages/WorkOrderDetailPage";
import { CommandCenter } from "./components/CommandCenter";
import { OEEDashboard } from "./pages/OEEDashboard";
import { SettingsPage } from "./pages/SettingsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { ResearchDashboard } from "./pages/ResearchDashboard";
import { TemplateSelectorPage } from "./pages/TemplateSelectorPage";
import { DeploymentConfiguratorPage } from "./pages/DeploymentConfiguratorPage";
import { motion, AnimatePresence } from "framer-motion";

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
    <BrowserRouter>
      <AnimatePresence mode="wait">
        {currentPage === "signin" && (
          <motion.div key="signin" {...pageTransition}>
            <Login onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
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
          <motion.div key="app" {...pageTransition} style={{ height: "100vh" }}>
            <AuthenticatedApp />
          </motion.div>
        )}
        {currentPage === "pricing" && (
          <motion.div key="pricing" {...pageTransition}>
            <Pricing />
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
    </BrowserRouter>
  );
}

function AuthenticatedApp() {
  const [currentPath, setCurrentPath] = useState("/overview");

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    window.history.pushState(null, "", path);
  };

  return (
    <AppShell currentPath={currentPath} onNavigate={handleNavigate}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewDashboard />} />
        <Route path="/performance" element={<PerformanceDashboard />} />
        <Route path="/work/:workOrderId" element={<WorkOrderDetailPage />} />
        <Route path="/work" element={<WorkDashboard />} />
        <Route path="/governance" element={<GovernanceDashboard />} />
        <Route path="/assets/:assetId" element={<AssetDetailPage />} />
        <Route path="/assets" element={<CommandCenter />} />
        <Route path="/oee" element={<OEEDashboard />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/research" element={<ResearchDashboard />} />
        <Route
          path="/deployments/new/configure"
          element={<DeploymentConfiguratorPage />}
        />
        <Route path="/deployments/new" element={<TemplateSelectorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </AppShell>
  );
}

export default App;
