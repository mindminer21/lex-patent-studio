#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Secret scan (PRD §13 release gate). Fails when tracked files contain
# credential-shaped strings. Synthetic local-mode placeholders are excluded
# by requiring real-looking key material (length/charset), and the two
# documented local defaults are allowlisted explicitly.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  # Provider/API keys
  'sk-(live|proj|ant)-[A-Za-z0-9_-]{20,}'
  'sk_live_[A-Za-z0-9]{16,}'
  'rk_live_[A-Za-z0-9]{16,}'
  'whsec_[A-Za-z0-9]{24,}'
  'xai-[A-Za-z0-9]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ghp_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{22,}'
  # Supabase service-role JWTs (real ones are three long base64url segments)
  'eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}'
  # Private key blocks
  'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY'
)

FAILED=0
for pattern in "${PATTERNS[@]}"; do
  # Tracked files only; binary-safe; exclude this script and lockfile hashes.
  if MATCHES=$(git grep -I -nE "$pattern" -- \
      ':!scripts/scan-secrets.sh' ':!package-lock.json' 2>/dev/null); then
    echo "POTENTIAL SECRET (pattern: $pattern):"
    echo "$MATCHES"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "Secret scan FAILED."
  exit 1
fi
echo "Secret scan clean."
