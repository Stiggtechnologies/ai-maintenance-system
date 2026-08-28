/**
 * Asset QR label — the phone-camera opens the asset detail directly.
 * No scanning library needed: the QR simply encodes the asset URL, and the
 * native phone camera handles the rest.
 */
import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import { assetQrDataUrl } from "../services/fieldCapture";

export function AssetQrLabel({
  assetId,
  assetTag,
}: {
  assetId: string;
  assetTag?: string | null;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    assetQrDataUrl(assetId)
      .then((u) => {
        if (alive) setDataUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assetId]);

  return (
    <div className="rounded-xl border border-industrial-border bg-industrial-graphite p-6 text-center">
      <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-industrial-text">
        <QrCode className="h-5 w-5 text-[#3A8DFF]" />
        Asset QR label
      </h2>
      <p className="mt-1 text-sm text-industrial-muted">
        Scan with any phone camera to open this asset in the field.
      </p>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR code for asset ${assetTag ?? assetId}`}
          className="mx-auto mt-4 h-44 w-44 rounded-lg bg-white p-2"
        />
      ) : (
        <div className="mx-auto mt-4 h-44 w-44 animate-pulse rounded-lg bg-white/5" />
      )}
      <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        {assetTag ?? assetId}
      </p>
      <a
        href={dataUrl ?? "#"}
        download={`${(assetTag ?? assetId).replace(/[^\w-]/g, "-")}-qr.png`}
        className="mt-3 inline-block text-xs font-medium text-[#3A8DFF] hover:underline"
      >
        Download label (PNG)
      </a>
    </div>
  );
}
