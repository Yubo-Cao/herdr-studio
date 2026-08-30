#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

program=${0##*/}
herdr_candidate=
studio_candidate=
build_id=
stock_version=
herdr_service=herdr.service
studio_service=herdr-gui.service
install_dir="$HOME/.local/bin"
release_root=${HERDR_DEPLOY_RELEASE_ROOT:-"$HOME/.local/lib/herdr-deployments"}

fail() {
  printf '%s: %s\n' "$program" "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    "Usage: $program --herdr PATH --studio PATH [options]" \
    "" \
    "Options:" \
    "  --build-id ID              Versioned release directory name" \
    "  --stock-version VERSION    Require the exact version used by stock clients" \
    "  --herdr-service UNIT       Default: herdr.service" \
    "  --studio-service UNIT      Default: herdr-gui.service" \
    "  --release-root DIR         Default: ~/.local/lib/herdr-deployments"
}

while (($#)); do
  case "$1" in
    --herdr)
      (($# >= 2)) || fail "--herdr requires a path"
      herdr_candidate=$2
      shift 2
      ;;
    --studio)
      (($# >= 2)) || fail "--studio requires a path"
      studio_candidate=$2
      shift 2
      ;;
    --build-id)
      (($# >= 2)) || fail "--build-id requires a value"
      build_id=$2
      shift 2
      ;;
    --stock-version)
      (($# >= 2)) || fail "--stock-version requires a value"
      stock_version=$2
      shift 2
      ;;
    --herdr-service)
      (($# >= 2)) || fail "--herdr-service requires a unit"
      herdr_service=$2
      shift 2
      ;;
    --studio-service)
      (($# >= 2)) || fail "--studio-service requires a unit"
      studio_service=$2
      shift 2
      ;;
    --release-root)
      (($# >= 2)) || fail "--release-root requires a directory"
      release_root=$2
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n $herdr_candidate ]] || fail "--herdr is required"
[[ -n $studio_candidate ]] || fail "--studio is required"
[[ -f $herdr_candidate && ! -L $herdr_candidate && -x $herdr_candidate ]] ||
  fail "Herdr candidate must be an executable regular file"
[[ -f $studio_candidate && ! -L $studio_candidate && -x $studio_candidate ]] ||
  fail "Studio candidate must be an executable regular file"
[[ $herdr_service =~ ^[A-Za-z0-9@_.-]+$ ]] || fail "invalid Herdr service name"
[[ $studio_service =~ ^[A-Za-z0-9@_.-]+$ ]] || fail "invalid Studio service name"

for command_name in systemctl install mv mktemp sha256sum jq readlink awk date; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "required command not found: $command_name"
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
handoff_dropin=$script_dir/../deploy/systemd/herdr-live-handoff.conf
[[ -f $handoff_dropin && ! -L $handoff_dropin ]] ||
  fail "missing handoff drop-in: $handoff_dropin"

systemd_version=$(systemctl --version | awk 'NR == 1 { print $2 }')
[[ $systemd_version =~ ^[0-9]+$ ]] || fail "could not determine systemd version"
((systemd_version >= 250)) || fail "ExitType=cgroup requires systemd 250 or newer"

[[ $(systemctl --user show "$herdr_service" --property=Type --value) == simple ]] ||
  fail "$herdr_service must use Type=simple"
systemctl --user is-active --quiet "$herdr_service" ||
  fail "$herdr_service is not active; live handoff requires a running server"
studio_was_active=false
if systemctl --user is-active --quiet "$studio_service"; then
  studio_was_active=true
fi

candidate_status=$("$herdr_candidate" status client --json)
candidate_version=$(jq -er '.version' <<<"$candidate_status")
candidate_protocol=$(jq -er '.protocol' <<<"$candidate_status")
[[ $candidate_protocol =~ ^[0-9]+$ ]] || fail "candidate protocol is invalid"
if [[ -n $stock_version && $candidate_version != "$stock_version" ]]; then
  fail "candidate advertises $candidate_version, but stock clients require $stock_version"
fi
"$herdr_candidate" api schema --json |
  jq -e '.. | objects | select(.const? == "collaboration.list")' >/dev/null ||
  fail "Herdr candidate does not include the collaboration API"

studio_version=$("$studio_candidate" --version)
studio_version=${studio_version#herdr-gui }
[[ -n $studio_version ]] || fail "could not determine Studio candidate version"

if [[ -z $build_id ]]; then
  herdr_sha=$(sha256sum "$herdr_candidate" | awk 'NR == 1 { print substr($1, 1, 12) }')
  build_id=$(date -u +%Y%m%dT%H%M%SZ)-$herdr_sha
fi
[[ $build_id =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid build id"

release_dir=$release_root/$build_id
[[ ! -e $release_dir ]] || fail "release already exists: $release_dir"
install -d -m 0755 "$release_root" "$release_dir" "$install_dir"
release_herdr=$release_dir/herdr
release_studio=$release_dir/herdr-gui
install -m 0755 "$herdr_candidate" "$release_herdr"
install -m 0755 "$studio_candidate" "$release_studio"

config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
dropin_dir=$config_home/systemd/user/$herdr_service.d
install -d -m 0755 "$dropin_dir"
install -m 0644 "$handoff_dropin" "$dropin_dir/live-handoff.conf"
systemctl --user daemon-reload
[[ $(systemctl --user show "$herdr_service" --property=ExitType --value) == cgroup ]] ||
  fail "systemd did not apply ExitType=cgroup to $herdr_service"
[[ $(systemctl --user show "$herdr_service" --property=Delegate --value) == yes ]] ||
  fail "systemd did not apply Delegate=yes to $herdr_service"
[[ $(systemctl --user show "$herdr_service" --property=OOMPolicy --value) == continue ]] ||
  fail "systemd did not apply OOMPolicy=continue to $herdr_service"

control_group=$(systemctl --user show "$herdr_service" --property=ControlGroup --value)
[[ $control_group == /* && $control_group != / ]] || fail "invalid service control group"
cgroup_root=/sys/fs/cgroup$control_group
[[ -r $cgroup_root/cgroup.procs ]] || fail "cannot read service cgroup processes"

collect_unit_pids() {
  local root=$1 procs pid
  while IFS= read -r -d '' procs; do
    while IFS= read -r pid; do
      [[ $pid =~ ^[0-9]+$ ]] && printf '%s\n' "$pid"
    done < "$procs"
  done < <(find "$root" -type f -name cgroup.procs -print0)
}

# Delegated agent limits place the manager and agent trees in child cgroups, so
# continuity checks must include the complete unit subtree rather than only the
# service root's direct processes.
mapfile -t before_pids < <(collect_unit_pids "$cgroup_root" | sort -n -u)

# ExitType=cgroup intentionally leaves MainPID=0 after the first live handoff.
# Locate the long-running server inside the unit cgroup so later deployments are
# just as safe as the first one. Pane commands may invoke `herdr`, so match only
# the server invocation used by an initial start or a handoff import.
server_pids=()
for pid in "${before_pids[@]}"; do
  [[ -r /proc/$pid/cmdline ]] || continue
  argv=()
  mapfile -d '' -t argv < "/proc/$pid/cmdline" || true
  ((${#argv[@]} >= 2)) || continue
  [[ ${argv[1]} == server ]] || continue
  if ((${#argv[@]} == 2)) || [[ ${argv[2]} == --handoff-import ]]; then
    server_pids+=("$pid")
  fi
done
[[ ${#server_pids[@]} -eq 1 ]] ||
  fail "expected exactly one running Herdr server in $herdr_service's cgroup; found ${#server_pids[@]}"
old_server_pid=${server_pids[0]}

printf 'Handing off %s (PID %s) to Herdr %s, protocol %s...\n' \
  "$herdr_service" "$old_server_pid" "$candidate_version" "$candidate_protocol"
"$release_herdr" server live-handoff \
  --import-exe "$release_herdr" \
  --expected-protocol "$candidate_protocol" \
  --expected-version "$candidate_version"

systemctl --user is-active --quiet "$herdr_service" ||
  fail "$herdr_service became inactive after handoff"
running_status=$("$release_herdr" status server --json)
jq -e \
  --arg version "$candidate_version" \
  --argjson protocol "$candidate_protocol" \
  '.running and .version == $version and .protocol == $protocol' \
  <<<"$running_status" >/dev/null ||
  fail "replacement server identity did not match the candidate"

mapfile -t after_pids < <(collect_unit_pids "$cgroup_root" | sort -n -u)
declare -A after_pid_set=()
replacement_pid=
for pid in "${after_pids[@]}"; do
  after_pid_set[$pid]=1
  executable=$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)
  if [[ $executable == "$release_herdr" ]]; then
    replacement_pid=$pid
  fi
done
[[ -n $replacement_pid ]] || fail "replacement server is not in $herdr_service's cgroup"

missing_pids=()
for pid in "${before_pids[@]}"; do
  [[ $pid == "$old_server_pid" ]] && continue
  [[ -n ${after_pid_set[$pid]:-} && -d /proc/$pid ]] || missing_pids+=("$pid")
done
if ((${#missing_pids[@]})); then
  fail "process continuity check failed for PID(s): ${missing_pids[*]}"
fi

atomic_install() {
  local source=$1
  local target=$2
  local target_dir=${target%/*}
  local target_name=${target##*/}
  local temporary backup_temporary
  temporary=$(mktemp "$target_dir/.$target_name.new.XXXXXX")
  install -m 0755 "$source" "$temporary"
  if [[ -f $target && ! -L $target ]]; then
    backup_temporary=$(mktemp "$target_dir/.$target_name.previous.XXXXXX")
    install -m 0755 "$target" "$backup_temporary"
    mv -f "$backup_temporary" "$target.previous"
  elif [[ -e $target || -L $target ]]; then
    fail "install target is not a regular file: $target"
  fi
  mv -f "$temporary" "$target"
}

atomic_install "$release_herdr" "$install_dir/herdr"
atomic_install "$release_studio" "$install_dir/herdr-gui"
exec_start=$(systemctl --user show "$herdr_service" --property=ExecStart --value)
[[ $exec_start == *"path=$install_dir/herdr ;"* ]] ||
  fail "$herdr_service cold-start command does not use $install_dir/herdr"
if $studio_was_active; then
  systemctl --user restart "$studio_service"
  systemctl --user is-active --quiet "$studio_service" ||
    fail "$studio_service did not become active"
fi

printf 'Live deployment complete.\n'
printf '  release: %s\n' "$release_dir"
printf '  Herdr:  %s (PID %s; %s preserved cgroup processes)\n' \
  "$candidate_version" "$replacement_pid" "$((${#before_pids[@]} - 1))"
if $studio_was_active; then
  printf '  Studio: %s (restarted)\n' "$studio_version"
else
  printf '  Studio: %s (installed; service left inactive)\n' "$studio_version"
fi
printf 'Use systemctl --user reload %s for future process-preserving replacements.\n' \
  "$herdr_service"
