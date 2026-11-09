#!/bin/sh
set -eu

# Install price-tracker with Docker Compose.
#
#   curl -fsSL https://raw.githubusercontent.com/furey/price-tracker/main/install.sh | sh
#
# Makes a folder (./price-tracker, or PRICE_TRACKER_DIR), downloads the compose
# file, asks for the dashboard password, region, Claude login token, and ntfy
# token, writes a .env with a generated session secret, then starts the app.
# Re-running it keeps an existing .env and compose file.

APP_DIR="${PRICE_TRACKER_DIR:-$PWD/price-tracker}"
APP_REF="${PRICE_TRACKER_REF:-main}"
RAW_URL="https://raw.githubusercontent.com/furey/price-tracker/${APP_REF}"
APP_PORT=4280

use_colour() { [ -t "$1" ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; }

ESC="$(printf '\033')"

paint() { printf '\033[%sm' "$1"; }

setup_colour() {
  RESET="" BOLD="" DIM="" ACCENT="" YELLOW="" GREEN="" LINK=""
  use_colour 1 || return 0
  accent=32
  case "${TERM:-}:${COLORTERM:-}" in
    *truecolor*|*24bit*) accent="38;2;34;197;94" ;;
    *256color*) accent="38;5;41" ;;
  esac
  RESET="$(paint 0)" BOLD="$(paint 1)" DIM="$(paint 2)" ACCENT="$(paint "1;$accent")"
  YELLOW="$(paint 93)" GREEN="$(paint 32)" LINK="$(paint "1;4;$accent")"
}

setup_colour
if use_colour 2; then ERR_RED="$(paint 31)" ERR_RESET="$(paint 0)"; else ERR_RED="" ERR_RESET=""; fi

say() { printf '%s\n' "$*"; }
info() { printf '%s[install]%s %s\n' "$DIM" "$RESET" "$*"; }
ok() { printf '%s[install]%s %s%s%s\n' "$DIM" "$RESET" "$GREEN" "$*" "$RESET"; }
warn() { printf '%s[install]%s %s%s%s\n' "$DIM" "$RESET" "$YELLOW" "$*" "$RESET"; }
fail() { printf '%s[install] %s%s\n' "$ERR_RED" "$*" "$ERR_RESET" >&2; exit 1; }

banner() {
  say ""
  printf ' %sprice-tracker%s\n' "$ACCENT" "$RESET"
  printf ' %sby @furey - https://about.me/jamesfurey%s\n' "$DIM" "$RESET"
  say ""
}

has_tty() { (exec < /dev/tty) 2>/dev/null; }

ask_key() {
  has_tty || return 0
  printf '%s%s%s ' "$BOLD" "$1" "$RESET" > /dev/tty
  tty_state="$(stty -g < /dev/tty)"
  trap 'stty "$tty_state" < /dev/tty; printf "\n" > /dev/tty; exit 130' INT TERM
  stty -icanon -echo min 1 time 0 < /dev/tty
  while :; do
    key="$(dd bs=1 count=1 < /dev/tty 2>/dev/null)"
    case "$2" in *"$key"*) break ;; esac
  done
  if [ "$key" = "$ESC" ]; then drain_tty; fi
  stty "$tty_state" < /dev/tty
  trap - INT TERM
  case "$key" in [[:alpha:]]) printf '%s\n' "$key" ;; *) printf '\n' ;; esac > /dev/tty
  printf '%s' "$key"
}

drain_tty() {
  stty min 0 time 1 < /dev/tty
  dd bs=16 count=1 < /dev/tty > /dev/null 2>&1 || true
}

ask_line() {
  printf '%s%s%s ' "$BOLD" "$1" "$RESET" > /dev/tty
  IFS= read -r line < /dev/tty || line=""
  printf '%s' "${line:-$2}"
}

ask_secret() {
  printf '%s%s%s ' "$BOLD" "$1" "$RESET" > /dev/tty
  tty_state="$(stty -g < /dev/tty)"
  trap 'stty "$tty_state" < /dev/tty; printf "\n" > /dev/tty; exit 130' INT TERM
  stty -echo < /dev/tty
  IFS= read -r line < /dev/tty || line=""
  stty "$tty_state" < /dev/tty
  trap - INT TERM
  printf '\n' > /dev/tty
  printf '%s' "$line"
}

ask_password() {
  while :; do
    password="$(ask_secret 'Dashboard password (at least 8 characters):')"
    case "$password" in
      *"'"*) warn "use a password without a single quote (')" > /dev/tty; continue ;;
    esac
    [ "${#password}" -ge 8 ] && break
    warn "too short; use at least 8 characters" > /dev/tty
  done
  printf '%s' "$password"
}

ask_region() {
  while :; do
    region="$(ask_line 'Region [au/us/generic] (au):' au)"
    case "$region" in
      au|us|generic) printf '%s' "$region"; return 0 ;;
    esac
    warn "type au, us, or generic" > /dev/tty
  done
}

ask_token() {
  while :; do
    token="$(ask_secret "$1")"
    case "$token" in
      *[[:space:]]*|*"'"*) warn "a token has no spaces or quotes; paste it again" > /dev/tty ;;
      *) printf '%s' "$token"; return 0 ;;
    esac
  done
}

random_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

host_zone() {
  if command -v timedatectl >/dev/null 2>&1; then
    timedatectl show -p Timezone --value 2>/dev/null && return
  fi
  zone="$(readlink /etc/localtime 2>/dev/null | sed -n 's#.*zoneinfo/##p')"
  [ -n "$zone" ] || zone="$(cat /etc/timezone 2>/dev/null || true)"
  printf '%s' "$zone"
}

host_address() {
  address=""
  if [ "$(uname -s)" = "Darwin" ]; then
    address="$(ipconfig getifaddr en0 2>/dev/null || true)"
    [ -n "$address" ] || address="$(ipconfig getifaddr en1 2>/dev/null || true)"
    printf '%s' "$address"
    return 0
  fi
  address="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$address" ] || address="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
  printf '%s' "$address"
}

owner_uid() { printf '%s' "${SUDO_UID:-$(id -u)}"; }

owner_gid() { printf '%s' "${SUDO_GID:-$(id -g)}"; }

url_host() {
  printf '%s' "$1" | sed -n 's#^[a-zA-Z][a-zA-Z0-9+.-]*://\([^/?#]*\).*#\1#p'
}

set_env() {
  ENV_KEY="$1" ENV_VALUE="$2" awk '
    BEGIN { key = ENVIRON["ENV_KEY"]; line = key "=" ENVIRON["ENV_VALUE"] }
    !done && ($0 ~ "^" key "=" || $0 ~ "^# " key "=") { print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' .env > .env.next
  mv .env.next .env
}

download() {
  curl -fsSL "$RAW_URL/$1" -o "$2" || fail "could not download $RAW_URL/$1"
}

write_env() {
  has_tty || fail "no terminal to ask for settings. Run this script in a terminal, or write $APP_DIR/.env first."
  previous_umask="$(umask)"
  umask 077
  download .env.example .env
  address="$(host_address || true)"
  default_url="http://${address:-localhost}:${APP_PORT}"
  say ""
  info "The dashboard needs a password; the app refuses to start without one."
  set_env APP_PASSWORD "'$(ask_password)'"
  set_env SESSION_SECRET "$(random_secret)"
  ok "generated SESSION_SECRET (64 random characters)"
  say ""
  info "Alert links open this address. Use the one you type in the browser."
  dashboard_url="$(ask_line "Dashboard URL ($default_url):" "$default_url")"
  dashboard_url="${dashboard_url%/}"
  dashboard_host="$(url_host "$dashboard_url")"
  [ -n "$dashboard_host" ] || fail "not a URL: $dashboard_url"
  set_env DASHBOARD_URL "$dashboard_url"
  set_env ALLOWED_HOSTS "$dashboard_host"
  say ""
  set_env REGION "$(ask_region)"
  say ""
  info "Run 'claude setup-token' on a computer with a browser to get a Claude login token."
  info "Leave it blank to paste it on the Settings page later."
  claude_token="$(ask_token 'Claude login token (hidden, optional):')"
  [ -z "$claude_token" ] || set_env CLAUDE_CODE_OAUTH_TOKEN "$claude_token"
  ntfy_token="$(ask_token 'ntfy access token (hidden, optional):')"
  [ -z "$ntfy_token" ] || set_env NTFY_ACCESS_TOKEN "$ntfy_token"
  set_env PUID "$(owner_uid)"
  set_env PGID "$(owner_gid)"
  zone="$(host_zone || true)"
  set_env TZ "${zone:-UTC}"
  umask "$previous_umask"
}

make_data_folders() {
  mkdir -p state logs
  [ "$(id -u)" -ne 0 ] || chown "$(owner_uid):$(owner_gid)" state logs .env
}

never_started() {
  [ -z "$(docker compose ps --all --quiet 2>/dev/null)" ]
}

command -v curl >/dev/null 2>&1 || fail "curl not found on the PATH."
command -v docker >/dev/null 2>&1 || fail "docker not found on the PATH. Install Docker first, or sign in over SSH so a NAS Docker is on the PATH."
docker compose version >/dev/null 2>&1 || fail "docker compose (v2) not found. Install the Docker Compose plugin."
docker info >/dev/null 2>&1 || fail "cannot reach the Docker daemon. Run this as a user in the docker group, or with sudo."

banner
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) fail "Windows is not supported. Run the app on Linux (a NAS, mini PC, or Raspberry Pi) or a Mac." ;;
esac
mkdir -p "$APP_DIR"
cd "$APP_DIR"
info "folder: $APP_DIR"

if [ -f docker-compose.yml ]; then
  info "keeping the existing docker-compose.yml"
else
  download docker-compose.example.yml docker-compose.yml
  ok "downloaded docker-compose.yml"
fi

if [ -f .env ]; then
  env_line="keeping the existing .env"
else
  write_env
  env_line="wrote .env"
fi
make_data_folders

if ! never_started; then
  info "$env_line"
else
  say ""
  ok "$env_line (secrets hidden):"
  grep -E '^(DASHBOARD_URL|ALLOWED_HOSTS|REGION|PUID|PGID|TZ)=' .env | sed 's/^/    /'
  answer="$(ask_key 'Start now? [Y/n/e = edit .env first]' "yYnNeE$ESC")"
  case "$answer" in
    "$ESC") warn "cancelled. Nothing started. Run this script again when you are ready."; exit 0 ;;
    n|N) warn "stopped. Edit $APP_DIR/.env, then run this script again."; exit 0 ;;
    e|E) "${EDITOR:-vi}" .env < /dev/tty > /dev/tty ;;
  esac
fi

docker compose pull app || fail "could not pull ghcr.io/furey/price-tracker. The image runs on amd64 and arm64 hosts only."
docker compose up -d

url="$(sed -n 's/^DASHBOARD_URL=//p' .env)"
say ""
printf '%s[install]%s %sPrice Tracker is starting.%s Open %s%s%s and sign in.\n' \
  "$DIM" "$RESET" "$GREEN" "$RESET" "$LINK" "${url:-http://localhost:$APP_PORT}" "$RESET"
info "Then give the example items private ntfy topics: docker exec price-tracker node src/cli.js rotate-topics"
info "To update later: cd $APP_DIR && docker compose pull && docker compose up -d"
