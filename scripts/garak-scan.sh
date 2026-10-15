#!/usr/bin/env bash
# SyncAI Guard — Garak LLM vulnerability scan.
# A missing NVIDIA_API_KEY or garak CLI is SKIPPED, not a pass. Exit 78
# (EX_CONFIG) so a direct run cannot look green. CI must skip the scan job
# before invoking this script; a missing secret on a fork must not fail CI.
# Never prints the key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBES_FILE="${ROOT}/config/syncai-guard/garak-probes.txt"

skip() {
  local reason="$1"
  echo "SKIPPED: ${reason}"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "result=skipped" >> "${GITHUB_OUTPUT}"
    echo "reason=${reason}" >> "${GITHUB_OUTPUT}"
  fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "### Garak"
      echo "SKIPPED: ${reason}"
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
  exit 78
}

if [[ -z "${NVIDIA_API_KEY:-}" ]]; then
  skip "NVIDIA_API_KEY is unset. Garak scan not run."
fi

if ! command -v garak >/dev/null 2>&1; then
  skip "garak CLI is not installed. Garak scan not run."
fi

PROBES="$(grep -v '^#' "${PROBES_FILE}" | grep -v '^$' | paste -sd, -)"
REPORT_PREFIX="${GARAK_REPORT_PREFIX:-/tmp/syncai-guard-garak}"
MODEL_NAME="${GARAK_MODEL_NAME:-nvidia/llama-3.1-nemotron-safety-guard-8b-v3}"

echo "syncai-guard: running garak probes ${PROBES} against ${MODEL_NAME}."
exec garak \
  --model_type nim \
  --model_name "${MODEL_NAME}" \
  --probes "${PROBES}" \
  --report_prefix "${REPORT_PREFIX}"
