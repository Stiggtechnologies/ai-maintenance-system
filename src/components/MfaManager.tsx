/**
 * MfaManager — TOTP multi-factor authentication enrollment and management,
 * backed by Supabase GoTrue MFA (SOC 2 CC6 / ISO 27001 A.8.5).
 *
 * A user enrolls an authenticator app (TOTP), verifies a 6-digit code to
 * activate the factor, and can remove it. Enrolled users are challenged for
 * their code at sign-in (see MfaChallenge). Enrollment is opt-in per account;
 * organization-wide enforcement is an app/DB policy step layered on top.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Trash2,
  QrCode,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface Factor {
  id: string;
  friendlyName?: string;
  status: string;
}

export function MfaManager() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    const { data, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      setError(listErr.message);
    } else {
      setFactors(
        (data?.totp ?? []).map((f) => ({
          id: f.id,
          friendlyName: f.friendly_name ?? undefined,
          status: f.status,
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  const verifiedFactors = factors.filter((f) => f.status === "verified");
  const mfaActive = verifiedFactors.length > 0;

  const startEnroll = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollErr) throw new Error(enrollErr.message);
      setEnrolling({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start enrollment.");
    } finally {
      setBusy(false);
    }
  };

  const verifyEnroll = async () => {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: chErr } =
        await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (chErr) throw new Error(chErr.message);
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyErr) throw new Error(verifyErr.message);
      setEnrolling(null);
      setCode("");
      setMessage("Multi-factor authentication is now active on your account.");
      await loadFactors();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That code didn't verify — check your authenticator and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unErr) throw new Error(unErr.message);
      setMessage("Authenticator removed.");
      await loadFactors();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the factor.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-sm">Loading security settings…</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="glass rounded-xl border border-white/[0.06] p-5">
        <div className="flex items-start gap-3">
          {mfaActive ? (
            <ShieldCheck
              className="mt-0.5 h-5 w-5 text-green-400"
              aria-hidden
            />
          ) : (
            <ShieldAlert
              className="mt-0.5 h-5 w-5 text-amber-400"
              aria-hidden
            />
          )}
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Multi-factor authentication (TOTP)
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {mfaActive
                ? "Your account requires a one-time code from your authenticator app at sign-in."
                : "Add an authenticator app (Google Authenticator, 1Password, Authy…) for a second factor at sign-in. Strongly recommended, and required by our security policy for privileged roles."}
            </p>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
              mfaActive
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {mfaActive ? "Enabled" : "Not enabled"}
          </span>
        </div>

        {message && (
          <p className="mt-3 text-sm text-green-300" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        {/* Active factors */}
        {verifiedFactors.length > 0 && (
          <ul className="mt-4 space-y-2">
            {verifiedFactors.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <span className="text-sm text-slate-200">
                  {f.friendlyName ?? "Authenticator app"}
                </span>
                <button
                  onClick={() => void removeFactor(f.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Enrollment flow */}
        {enrolling ? (
          <div className="mt-4 rounded-lg border border-teal-500/20 bg-teal-500/[0.04] p-4">
            <p className="text-sm font-medium text-[#E6EDF3]">
              Scan this QR code with your authenticator app
            </p>
            <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              {/* GoTrue returns the QR as an SVG data URI. */}
              <img
                src={enrolling.qr}
                alt="MFA QR code"
                className="h-40 w-40 rounded-lg bg-white p-2"
              />
              <div className="text-xs text-slate-400">
                <p>Can't scan? Enter this secret manually:</p>
                <code className="mt-1 block break-all rounded bg-black/40 px-2 py-1 font-mono text-slate-300">
                  {enrolling.secret}
                </code>
              </div>
            </div>
            <label className="mt-4 block text-xs font-medium text-slate-300">
              Enter the 6-digit code to activate
            </label>
            <div className="mt-1 flex gap-2">
              <input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                aria-label="Verification code"
                className="w-32 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm tracking-widest text-white focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
              <button
                onClick={() => void verifyEnroll()}
                disabled={busy || code.length < 6}
                className="inline-flex items-center gap-2 rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                {busy && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Activate
              </button>
              <button
                onClick={() => {
                  setEnrolling(null);
                  setCode("");
                }}
                disabled={busy}
                className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          !mfaActive && (
            <button
              onClick={() => void startEnroll()}
              disabled={busy}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              <QrCode className="h-4 w-4" aria-hidden />
              Set up authenticator app
            </button>
          )
        )}
      </div>
    </div>
  );
}
