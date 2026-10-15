#!/usr/bin/env bash
# Saves one secret into every repo that runs the kit, so renewing a token is
# one step instead of one per repo. Run it yourself, in a terminal:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/bigapejit/bakuljan/main/scripts/share-secret.sh) AGENT_PAT
#
# The value is asked for without echoing and goes only to `gh secret set`. An
# AGENT_PAT is checked against every repo first, so a token missing a scope or
# a repo fails here instead of as a silent stall in some later workflow.
set -euo pipefail

name=${1:?usage: share-secret.sh SECRET_NAME}
owner=${OWNER:-bigapejit}

# A repo runs the kit when one of its workflows calls bigapejit/bakuljan.
repos=$(gh search code "bigapejit/bakuljan/.github/workflows/" --owner "$owner" --limit 200 \
  --json repository,path \
  --jq '.[] | select(.path | startswith(".github/workflows/")) | .repository.nameWithOwner' |
  grep -vx "$owner/bakuljan" | sort -u)
if [ -z "$repos" ]; then
  echo "No repo of $owner calls the kit." >&2
  exit 1
fi
echo "Repos that run the kit:"
printf '  %s\n' $repos

read -rsp "Paste $name (hidden): " value
echo
if [ -z "$value" ]; then
  echo "Nothing pasted; no secret changed." >&2
  exit 1
fi

if [ "$name" = AGENT_PAT ]; then
  scopes=$(GH_TOKEN=$value gh api -i user 2>/dev/null | tr -d '\r' | sed -n 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: //p') || true
  if [ -z "$scopes" ] && ! GH_TOKEN=$value gh api user >/dev/null 2>&1; then
    echo "GitHub rejected that token; no secret changed." >&2
    exit 1
  fi
  for scope in repo workflow read:org; do
    # A fine-grained token reports no scopes; the per-repo check below covers it.
    if [ -n "$scopes" ] && [[ " ${scopes//,/ } " != *" $scope "* ]]; then
      echo "The token lacks the $scope scope; no secret changed." >&2
      exit 1
    fi
  done
  for repo in $repos; do
    if [ "$(GH_TOKEN=$value gh api "repos/$repo" --jq .permissions.push 2>/dev/null)" != true ]; then
      echo "The token cannot push to $repo; no secret changed." >&2
      exit 1
    fi
  done
fi

for repo in $repos; do
  printf '%s' "$value" | gh secret set "$name" -R "$repo"
done
echo "$name saved to every repo above."
