import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { EnterpriseAccess } from './pages/EnterpriseAccess';
import { CommandCenter } from './components/CommandCenter';
import { LoadingScreen } from './components/LoadingScreen';
import { Pricing } from './pages/Pricing';
import { Security } from './pages/Security';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { MarketplaceActivate } from './pages/MarketplaceActivate';
import { motion, AnimatePresence } from 'framer-motion';

type Page = 'signin' | 'signup' | 'enterprise' | 'app' | 'pricing' | 'security' | 'privacy' | 'terms' | 'marketplace_activate';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('signin');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Microsoft AppSource activation deep-link: /marketplace/activate?token=…
    // Check this BEFORE auth resolution so the buyer always lands on the
    // activation flow regardless of any existing session.
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/marketplace/activate')) {
      setCurrentPage('marketplace_activate');
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      if (session) setCurrentPage('app');
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (session) setCurrentPage('app');
      else setCurrentPage('signin');
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
    setCurrentPage('app');
  };

  if (loading) return <LoadingScreen />;

  const pageTransition = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.15 },
  };

  return (
    <AnimatePresence mode="wait">
      {currentPage === 'signin' && (
        <motion.div key="signin" {...pageTransition}>
          <Login onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'signup' && (
        <motion.div key="signup" {...pageTransition}>
          <Signup onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'enterprise' && (
        <motion.div key="enterprise" {...pageTransition}>
          <EnterpriseAccess onSuccess={handleAuthSuccess} onTabChange={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'app' && isAuthenticated && (
        <motion.div key="app" {...pageTransition} style={{ height: '100vh' }}>
          <CommandCenter />
        </motion.div>
      )}
      {currentPage === 'pricing' && (
        <motion.div key="pricing" {...pageTransition}>
          <Pricing />
        </motion.div>
      )}
      {currentPage === 'security' && (
        <motion.div key="security" {...pageTransition}>
          <Security onNavigate={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'privacy' && (
        <motion.div key="privacy" {...pageTransition}>
          <Privacy onNavigate={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'terms' && (
        <motion.div key="terms" {...pageTransition}>
          <Terms onNavigate={setCurrentPage} />
        </motion.div>
      )}
      {currentPage === 'marketplace_activate' && (
        <motion.div key="marketplace_activate" {...pageTransition}>
          <MarketplaceActivate
            onContinueToSignup={() => {
              // After activation, send buyer to signup. The MarketplaceActivate
              // component has already stashed purchaser_email + plan_id in
              // sessionStorage; Signup picks them up there.
              setCurrentPage('signup');
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
