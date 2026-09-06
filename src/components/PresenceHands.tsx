/**
 * Optional Meet Sync webcam overlay, adapted from barehands.
 *
 * Camera stays in the browser. Gestures may send Ask, pause listen, or
 * mute. They never execute plant actions.
 */
import { useEffect, useRef } from "react";
import {
  classifyLandmarks,
  mapHandGestureToBoothAction,
  pinchDistance,
  type BoothHandAction,
} from "../lib/presence/hands";

interface PresenceHandsProps {
  enabled: boolean;
  hasInput: boolean;
  busy: boolean;
  muted: boolean;
  onAction: (action: BoothHandAction) => void;
}

const MEDIAPIPE_SCRIPT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
const MEDIAPIPE_CAMERA =
  "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";

export function PresenceHands({
  enabled,
  hasInput,
  busy,
  muted,
  onAction,
}: PresenceHandsProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const actionRef = useRef(onAction);
  const inputRef = useRef({ hasInput, busy, muted });
  actionRef.current = onAction;
  inputRef.current = { hasInput, busy, muted };

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let lastAction: BoothHandAction = "none";
    let lastAt = 0;

    const start = async () => {
      try {
        await loadScript(MEDIAPIPE_SCRIPT);
        await loadScript(MEDIAPIPE_CAMERA);
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
        });
        video.srcObject = stream;
        await video.play();
        const HandsCtor = (
          window as unknown as {
            Hands?: new (opts: { locateFile: (file: string) => string }) => {
              setOptions: (opts: Record<string, unknown>) => void;
              onResults: (cb: (results: MediaPipeHandsResult) => void) => void;
              send: (input: { image: HTMLVideoElement }) => Promise<void>;
              close: () => void;
            };
          }
        ).Hands;
        if (!HandsCtor) return;
        const hands = new HandsCtor({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,
          selfieMode: true,
        });
        hands.onResults((results) => {
          const landmarks = results.multiHandLandmarks?.[0];
          if (!landmarks) return;
          const thumb = landmarks[4];
          const index = landmarks[8];
          const pinch = pinchDistance(
            thumb ? { x: thumb.x, y: thumb.y } : null,
            index ? { x: index.x, y: index.y } : null,
          );
          const fingers = [8, 12, 16, 20].filter((tip) => {
            const point = landmarks[tip];
            const pip = landmarks[tip - 2];
            return point && pip && point.y < pip.y;
          }).length;
          const gesture = classifyLandmarks({
            pinch,
            fingersExtended: fingers,
          });
          const action = mapHandGestureToBoothAction({
            gesture,
            ...inputRef.current,
          });
          const now = Date.now();
          if (
            action !== "none" &&
            (action !== lastAction || now - lastAt > 900)
          ) {
            lastAction = action;
            lastAt = now;
            actionRef.current(action);
          }
        });
        const loop = async () => {
          if (cancelled) {
            hands.close();
            return;
          }
          if (video.readyState >= 2) {
            await hands.send({ image: video });
          }
          requestAnimationFrame(() => {
            void loop();
          });
        };
        void loop();
      } catch {
        // Camera or MediaPipe unavailable — typed Ask and listen still work.
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      data-testid="presence-hands"
      className="mt-2 overflow-hidden rounded-md border border-white/10"
    >
      <p className="px-2 pt-1.5 text-[11px] text-slate-500">
        Hands overlay — pinch sends when there is text, open palm pauses listen,
        point mutes. Camera stays in this browser. No plant execute.
      </p>
      <video
        ref={videoRef}
        muted
        playsInline
        className="mt-1 h-28 w-full bg-black/40 object-cover"
        aria-label="Meet Sync hands camera"
      />
    </div>
  );
}

interface MediaPipeHandsResult {
  multiHandLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}
