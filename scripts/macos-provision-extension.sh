#!/bin/bash
# CloudFuze AI-Governance — silent browser-extension provisioning for macOS.
#
# The Windows counterpart (intune-provision-extension.ps1) does nothing on a Mac,
# so without this those machines have no extension at all. Deploy this as an Intune
# **shell script** for macOS with "Run script as signed-in user" = **No** (root).
#
# ONE RUN ONLY, unlike Windows. The Windows script has a second, user-context pass
# for per-user identity because Chromium reads policy from HKCU there. macOS has no
# equivalent — see the user-context branch below — so per-user identity is handled
# by the extension's domain-guarded browser profile instead.
#
# HOW MANAGED CONFIG REACHES THE EXTENSION ON macOS. There is no registry. Chrome
# reads chrome.storage.managed from a per-extension plist in
# /Library/Managed Preferences, named <browser-bundle-id>.extensions.<ext-id>.plist,
# and reads browser policy (the force-install list) from <browser-bundle-id>.plist
# in the same directory. Each Chromium browser has its own bundle id, so the same
# values are written once per browser.
#
# WHAT IS DIFFERENT FROM WINDOWS, AND WORTH KNOWING BEFORE YOU RELY ON IT.
# Windows hands us the enrolled user's UPN in the registry, which is ground truth.
# macOS has no single equivalent that is guaranteed present, so the lookup below
# tries several documented sources in order and REPORTS WHICH ONE ANSWERED. If none
# do, identity is left unset on purpose and the extension falls back to the
# domain-guarded browser profile — which on a managed Mac signed into the corporate
# account is usually the right answer anyway, and can never produce a wrong name.
#
# Treat the identity half as unverified until a pilot Mac prints its source. The
# force-install half is standard and does not depend on any of that.

set -uo pipefail

# ---- CONFIG (edit these) -----------------------------------------------------
EXTENSION_ID="REPLACE_WITH_ID_FROM_pack-crx"   # 32 chars a-p, from pack-crx.mjs
SERVER_URL="https://agentgovernence.cftools.live"
ENROLL_SECRET="REPLACE_WITH_ENROLL_SECRET"
IDENTITY_DOMAIN="cloudfuze.com"                # empty string disables the guard
BROWSER_ONLY=1                                 # 1 when no desktop agent is deployed
PER_USER_IDENTITY=0                            # 1 on SHARED Macs: skips writing a
                                               # machine-wide userEmail, so the
                                               # per-person browser profile answers
                                               # instead of one enrollment identity
                                               # being stamped on every account.
# -----------------------------------------------------------------------------

MANAGED_DIR="/Library/Managed Preferences"
UPDATE_URL="${SERVER_URL}/downloads/update.xml"

if [[ "$EXTENSION_ID" == REPLACE_* ]]; then
  echo "EXTENSION_ID is not set. Run: node scripts/pack-crx.mjs --url $SERVER_URL" >&2
  exit 1
fi

# Bundle ids, one per Chromium browser. Written whether the browser is installed or
# not: a plist for an absent browser is inert, whereas detect-then-write leaves a
# browser someone installs next week ungoverned until this runs again.
BROWSERS=(
  "com.google.Chrome"
  "com.microsoft.Edge"
  "com.brave.Browser"
  "com.vivaldi.Vivaldi"
  "com.operasoftware.Opera"
  "org.chromium.Chromium"
)

# ---- Identity ---------------------------------------------------------------
# Each source is tried in order; the first that yields something containing "@"
# wins. Every one of these is best-effort — that is the honest position on macOS,
# and it is why the source is printed rather than assumed.
# THE CONSOLE USER, NOT root. This script runs as root, and `defaults read` is
# per-user: as root it reads /var/root's preferences, where Company Portal has
# never written anything. Every user-scoped lookup below therefore has to be
# executed AS the person actually logged in. `stat -f%Su /dev/console` is the
# standard way to identify them; it returns "root" at the loginwindow, which is
# treated as "nobody is logged in".
console_user() {
  local u
  u=$(stat -f%Su /dev/console 2>/dev/null)
  [[ -n "$u" && "$u" != "root" ]] && echo "$u"
}

# Run a command as the console user, or fail quietly when nobody is logged in.
as_user() {
  local u
  u=$(console_user) || return 1
  [[ -z "$u" ]] && return 1
  launchctl asuser "$(id -u "$u")" sudo -u "$u" "$@" 2>/dev/null
}

resolve_upn() {
  local candidate=""

  # 1. Platform SSO / Microsoft Enterprise SSO registration. Present on Macs that
  #    have completed Entra registration, which is the common Intune posture.
  candidate=$(as_user defaults read com.microsoft.CompanyPortal aadUserPrincipalName)
  if [[ "$candidate" == *@* ]]; then echo "$candidate|company_portal"; return; fi

  # 2. Company Portal's signed-in account under a different key across versions.
  candidate=$(as_user defaults read com.microsoft.CompanyPortal userPrincipalName)
  if [[ "$candidate" == *@* ]]; then echo "$candidate|company_portal_alt"; return; fi

  # 3. The Mac's own account record for that user — again the CONSOLE user, since
  #    /Users/root has no email attribute and would always miss.
  local u
  u=$(console_user)
  if [[ -n "$u" ]]; then
    candidate=$(dscl . -read "/Users/$u" EMailAddress 2>/dev/null | awk '{print $2}')
    if [[ "$candidate" == *@* ]]; then echo "$candidate|dscl_email"; return; fi
  fi

  # 4. MDM enrollment profile. Needs root; harmless when it does not match.
  if [[ $EUID -eq 0 ]]; then
    candidate=$(profiles show -type enrollment 2>/dev/null \
      | grep -iEo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -1)
    if [[ "$candidate" == *@* ]]; then echo "$candidate|mdm_enrollment"; return; fi
  fi

  echo "|none"
}

IFS='|' read -r RESOLVED_UPN UPN_SOURCE <<< "$(resolve_upn)"
COMPUTER_NAME=$(scutil --get ComputerName 2>/dev/null || hostname)

write_pref() {  # domain, key, value
  defaults write "${MANAGED_DIR}/$1.plist" "$2" -string "$3" 2>/dev/null \
    || { echo "  failed writing $2 to $1 (need root?)" >&2; return 1; }
}

# ---- User-context run -------------------------------------------------------
# THE WINDOWS TRICK DOES NOT TRANSLATE, and the failure would have been silent.
#
# On Windows a per-user identity works because Chromium reads policy from HKCU,
# which the user can write. macOS has no equivalent: chrome.storage.managed is
# populated ONLY from /Library/Managed Preferences, which is root-owned and owned
# by the MDM channel. A plist written into the user's own domain
# (~/Library/Preferences/...) is simply ignored — the write succeeds, `defaults
# read` shows the value, and the extension never sees it. That is worse than doing
# nothing, because it looks like it worked.
#
# There is a per-user managed path, /Library/Managed Preferences/<user>/, but it
# needs root, so a user-context script cannot write it either — and a root script
# cannot reliably tell which corporate identity belongs to which local account.
#
# So on macOS the per-user answer is the extension's own domain-guarded browser
# profile. That is naturally per-person, and with IDENTITY_DOMAIN set it can never
# attribute a personal account. Set IDENTITY_DOMAIN and leave this alone.
if [[ $EUID -ne 0 ]]; then
  echo "This script must run as root on macOS."
  echo
  echo "Per-user identity is not scriptable here: chrome.storage.managed comes only"
  echo "from /Library/Managed Preferences, so a plist in a user's own domain is"
  echo "ignored even though the write succeeds. On shared Macs, set IDENTITY_DOMAIN"
  echo "and let the extension use the signed-in browser profile — it is per-person"
  echo "by construction and the domain guard stops a personal account being used."
  exit 1
fi

# ---- Root run: force-install + machine-wide config --------------------------
echo "Device: $COMPUTER_NAME"
if [[ -n "$RESOLVED_UPN" ]]; then
  echo "Identity: $RESOLVED_UPN (source: $UPN_SOURCE)"
else
  echo "Identity: none found — the extension will fall back to the domain-guarded"
  echo "browser profile. Set IDENTITY_DOMAIN so that fallback cannot attribute a"
  echo "personal account."
fi

mkdir -p "$MANAGED_DIR"

for b in "${BROWSERS[@]}"; do
  # 1) Force-install from our own update manifest, plus the two allowances that an
  #    off-store install needs. Without them the force-install entry is accepted
  #    and then silently ignored — nothing installs and nothing is logged.
  defaults write "${MANAGED_DIR}/${b}.plist" ExtensionInstallForcelist \
    -array "${EXTENSION_ID};${UPDATE_URL}" 2>/dev/null
  defaults write "${MANAGED_DIR}/${b}.plist" ExtensionInstallAllowlist \
    -array "${EXTENSION_ID}" 2>/dev/null
  defaults write "${MANAGED_DIR}/${b}.plist" ExtensionInstallSources \
    -array "${SERVER_URL}/*" 2>/dev/null

  # 2) Managed config the extension reads via chrome.storage.managed.
  ext_domain="${b}.extensions.${EXTENSION_ID}"
  write_pref "$ext_domain" serverUrl    "$SERVER_URL"
  write_pref "$ext_domain" enrollSecret "$ENROLL_SECRET"
  write_pref "$ext_domain" computerName "$COMPUTER_NAME"
  [[ -n "$IDENTITY_DOMAIN" ]] && write_pref "$ext_domain" identityDomain "$IDENTITY_DOMAIN"
  [[ "$BROWSER_ONLY" == "1" ]] && write_pref "$ext_domain" browserOnly "1"

  # userEmail is skipped under PER_USER_IDENTITY for the same reason as Windows:
  # a machine-wide value would win over the per-user one and put this Mac's
  # enrollment identity on every account that uses it.
  if [[ -n "$RESOLVED_UPN" && "$PER_USER_IDENTITY" != "1" ]]; then
    write_pref "$ext_domain" userEmail "$RESOLVED_UPN"
  fi

  echo "Provisioned ${b}"
done

# Managed Preferences are normally owned by the MDM channel, and macOS caches
# them. A restart of the browser is enough for the extension config; the
# force-install list is picked up on the next policy refresh.
killall cfprefsd 2>/dev/null || true
echo "Done. Restart the browsers to pick this up."
