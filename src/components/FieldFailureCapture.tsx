/**
 * Field failure capture — the mobile-first field panel (E6.13 first slice).
 *
 * Big-button flow for gloves-on use: type chips -> description -> camera
 * photo -> submit. The photo travels through the tenant storage folder and
 * the governed attach RPC; nothing leaves the organization boundary.
 */
import { useRef, useState } from "react";
import { Camera, Send, CheckCircle2 } from "lucide-react";
import { reportFailure } from "../services/fieldCapture";

const TYPES = [
  { id: "fault", label: "Fault" },
  { id: "observation", label: "Observation" },
  { id: "safety", label: "Safety" },
  { id: "request", label: "Request" },
] as const;

export function FieldFailureCapture({
  assetId,
  assetTag,
}: {
  assetId: string;
  assetTag?: string | null;
}) {
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("fault");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = (file: File | undefined) => {
    setPhoto(file ?? null);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const submit = async () => {
    setError(null);
    setDone(null);
    if (description.trim().length < 5) {
      setError(
        "Describe what you observed — a report with no observation is not a report.",
      );
      return;
    }
    setBusy(true);
    try {
      await reportFailure({
        assetId,
        description: description.trim(),
        notificationType: type,
        photo: photo ?? undefined,
      });
      setDone(
        photo
          ? `Notification filed — photo attached as evidence.`
          : "Notification filed.",
      );
      setDescription("");
      setPhoto(null);
      setPhotoPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-industrial-border bg-industrial-graphite p-6">
      <h2 className="text-lg font-semibold text-industrial-text">
        Report failure from the field
      </h2>
      <p className="mt-1 text-sm text-industrial-muted">
        Scan the asset QR, capture the evidence, and file the governed report —
        the photo becomes part of the failure investigation record.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setType(t.id)}
            aria-pressed={type === t.id}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              type === t.id
                ? "bg-[#3A8DFF] text-white"
                : "border border-industrial-border text-industrial-muted hover:bg-industrial-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="What did you observe? (e.g., hydraulic leak at the boom joint — fluid loss ~2L/min)"
        className="mt-4 w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text placeholder:text-industrial-muted/60 focus:border-[#3A8DFF] focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-4 py-3 text-sm font-semibold text-industrial-text hover:bg-industrial-surface"
        >
          <Camera className="h-4 w-4" />
          {photo ? "Retake photo" : "Take photo"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pickPhoto(e.target.files?.[0])}
        />
        {photoPreview && (
          <img
            src={photoPreview}
            alt="Failure evidence preview"
            className="h-20 w-20 rounded-lg border border-industrial-border object-cover"
          />
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {done && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4" /> {done}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#3A8DFF] px-4 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#2E7AE6] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        <Send className="h-4 w-4" />
        {busy
          ? "Filing…"
          : `File ${type} report${assetTag ? ` — ${assetTag}` : ""}`}
      </button>
    </section>
  );
}
