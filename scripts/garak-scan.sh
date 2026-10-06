#!/usr/bin/env bash
# SyncAI Guard — Garak LLM vulnerability scan.
# Exits 0 when NVIDIA_API_KEY or the garak CLI is absent so CI stays green
# on a public repo that has no NVIDIA key. Never prints the key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBES_FILE="${ROOT}/config/syncai-guard/garak-probes.txt"

if [[ -z "${NVIDIA_API_KEY:-}" ]]; then
  echo "syncai-guard: NVIDIA_API_KEY is unset; Garak scan skipped."
  exit 0
fi

if ! command -v garak >/dev/null 2>&1; then
  echo "syncai-guard: garak is not installed; scan skipped. See docs/syncai-guard.md."
  exit 0
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
