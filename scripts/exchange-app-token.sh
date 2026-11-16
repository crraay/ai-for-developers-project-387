#!/usr/bin/env bash
# Exchange the workflow's OIDC token for a short-lived OpenCode App token.
#
# The caller must grant `id-token: write`. The token is masked before it is
# written to GITHUB_OUTPUT, which is the only supported mode: a step that needs
# the value declares an id and reads steps.<id>.outputs.app-token.
set -euo pipefail

oidc_url="${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
oidc_request_token="${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}"
if [[ -z "$oidc_url" || -z "$oidc_request_token" ]]; then
  echo "::error::OIDC is not available; id-token: write is required." >&2
  exit 1
fi

oidc=$(curl -fsS \
  -H "Authorization: bearer $oidc_request_token" \
  "$oidc_url&audience=opencode-github-action" | jq -r .value)
if [[ -z "$oidc" || "$oidc" == "null" ]]; then
  echo "::error::OIDC token request failed." >&2
  exit 1
fi

app=$(curl -fsS -X POST \
  -H "Authorization: Bearer $oidc" \
  https://api.opencode.ai/exchange_github_app_token | jq -r .token)
if [[ -z "$app" || "$app" == "null" ]]; then
  echo "::error::OpenCode App token exchange failed." >&2
  exit 1
fi

echo "::add-mask::$app"
if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "::error::GITHUB_OUTPUT is not set; the token is only written as a step output." >&2
  exit 1
fi
printf 'app-token=%s\n' "$app" >> "$GITHUB_OUTPUT"
