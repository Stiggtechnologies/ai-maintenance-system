import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Video surveillance. */
export const videoSurveillanceTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CCTV",
  name: "Video surveillance",
  family: "physical_security",
  description:
    "Reusable engineering template for cameras, recorders and monitoring. Retention and coverage come only from the approved security policy.",
  functions: ["record site video", "support incident review"],
  operatingStates: ["recording", "degraded", "offline"],
  standards: ["EN 62676", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CCTV-CAMERAS",
      name: "Cameras",
      functions: ["capture video"],
      telemetryConcepts: ["camera_status", "image_quality"],
      inspectionZones: ["cameras", "mounts"],
      failureModes: [
        f(
          "CCTV-CAMERA-LOSS",
          "CCTV-CAMERAS",
          "Camera failure or obstruction",
          "failed or blocked cameras leave coverage gaps",
          ["hardware failure", "obstruction", "misalignment"],
          ["no evidence of an incident"],
          ["camera_status"],
          ["coverage_review"],
          2,
        ),
      ],
    },
    {
      code: "CCTV-RECORDING",
      name: "Recorders and storage",
      functions: ["store video for the retention period"],
      telemetryConcepts: ["recorder_status", "storage_status"],
      inspectionZones: ["recorders", "storage"],
      failureModes: [
        f(
          "CCTV-STORAGE-FAIL",
          "CCTV-RECORDING",
          "Recording or storage failure",
          "disk or recorder failure loses footage",
          ["disk failure", "full storage"],
          ["lost evidence"],
          ["storage_status"],
          ["recording_verification"],
          3,
        ),
      ],
    },
  ],
};
