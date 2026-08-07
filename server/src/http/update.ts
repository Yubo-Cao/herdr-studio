import { basename } from "node:path";

type RunProcessWithCodeTimeout = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const UPDATE_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
] as const;

type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];

export interface UpdateTarget {
  platform: UpdatePlatform;
  packageDir: string;
  archiveName: string;
}

interface UpdateRuntime {
  platform: string;
  arch: string;
  execPath: string;
  argv: string[];
}

const DEFAULT_UPDATE_BASE_URL =
  "https://github.com/powerfooI/herdr-gui/releases/latest/download";
const UPDATE_CHECK_TIMEOUT_MS = 15000;
const UPDATE_INSTALL_TIMEOUT_MS = 120000;
export const UPDATE_HTTP_IDLE_TIMEOUT_SECONDS =
  Math.ceil((UPDATE_CHECK_TIMEOUT_MS + UPDATE_INSTALL_TIMEOUT_MS) / 1000) + 15;

export function resolveUpdateTarget(
  platform: string,
  arch: string,
): UpdateTarget | null {
  const candidate = `${platform}-${arch}`;
  const updatePlatform = UPDATE_PLATFORMS.find(
    (publishedPlatform) => publishedPlatform === candidate,
  );
  if (updatePlatform === undefined) return null;
  return {
    platform: updatePlatform,
    packageDir: `herdr-gui-${updatePlatform}`,
    archiveName: `herdr-gui-${updatePlatform}.tar.xz`,
  };
}

export function parseUpdateVersionFile(text: string): {
  version: string;
  platform: string;
} {
  const [name, version, platform] = text.trim().split(/\s+/);
  if (name !== "herdr-gui" || !version || !platform) {
    throw new Error(`invalid update VERSION file: ${text.trim()}`);
  }
  return { version, platform };
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number(part));
  const pb = b.split(".").map((part) => Number(part));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = Number.isFinite(pa[i]) ? pa[i] : 0;
    const vb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

export function isSupervisorManagedEnvironment(
  environment: Record<string, string | undefined>,
): boolean {
  const override = environment.HERDR_GUI_RESTART_SUPERVISOR;
  if (override === "1") return true;
  if (override === "0") return false;
  if (environment.INVOCATION_ID) return true;
  const xpcServiceName = environment.XPC_SERVICE_NAME;
  return Boolean(xpcServiceName && xpcServiceName !== "0");
}

export function createUpdateHandlers({
  appVersion,
  runProcessWithCodeTimeout,
  shQuote,
  runtime: runtimeOverride,
  scheduleProcessExit: scheduleProcessExitOverride,
  environment: environmentOverride,
}: {
  appVersion: string;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  shQuote: (value: string) => string;
  runtime?: UpdateRuntime;
  scheduleProcessExit?: () => void;
  environment?: Record<string, string | undefined>;
}) {
  const runtime: UpdateRuntime = runtimeOverride ?? {
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    argv: process.argv,
  };
  const environment = environmentOverride ?? process.env;
  const updateTarget = resolveUpdateTarget(runtime.platform, runtime.arch);
  let updateInstallInProgress = false;

  function updateBaseUrl(): string {
    return (
      environment.HERDR_GUI_UPDATE_BASE_URL ?? DEFAULT_UPDATE_BASE_URL
    ).replace(/\/+$/, "");
  }

  function updateArchiveUrl(): string {
    return updateTarget
      ? `${updateBaseUrl()}/${updateTarget.archiveName}`
      : updateBaseUrl();
  }

  function autoUpdateCapability(): {
    canAutoUpdate: boolean;
    reason?: string;
    targetPath?: string;
  } {
    if (!updateTarget) {
      return {
        canAutoUpdate: false,
        reason: `Auto update is not available for ${runtime.platform}-${runtime.arch}.`,
      };
    }
    const invoked = runtime.argv[1] ?? "";
    const exeName = basename(runtime.execPath);
    if (exeName === "bun" || invoked.endsWith("src/index.ts")) {
      return {
        canAutoUpdate: false,
        reason: "Auto update is only available in the standalone binary.",
      };
    }
    if (!isSupervisorManagedEnvironment(environment)) {
      return {
        canAutoUpdate: false,
        reason:
          "Automatic updates require an external process supervisor such as systemd or launchd.",
      };
    }
    return { canAutoUpdate: true, targetPath: runtime.execPath };
  }

  // The updater owns replacement and shutdown only. An external supervisor
  // starts the new process after this response has had time to reach the client.
  function scheduleManagedExit() {
    if (scheduleProcessExitOverride) {
      scheduleProcessExitOverride();
      return;
    }
    const timer = setTimeout(() => {
      process.exit(0);
    }, 1000);
    if ("unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
  }

  async function readLatestUpdateVersion(): Promise<{
    version: string;
    platform: string;
  }> {
    if (!updateTarget) {
      throw new Error(
        `no update package is available for ${runtime.platform}-${runtime.arch}`,
      );
    }
    const versionPath = `${updateTarget.packageDir}/VERSION`;
    const command =
      `curl -fsSL ${shQuote(updateArchiveUrl())} | ` +
      `tar -xJOf - ${shQuote(versionPath)}`;
    const result = await runProcessWithCodeTimeout(
      ["sh", "-c", command],
      UPDATE_CHECK_TIMEOUT_MS,
    );
    if (result.code !== 0) {
      throw new Error(
        (result.stderr || result.stdout || `update check exited ${result.code}`)
          .trim()
          .slice(0, 500),
      );
    }
    const latest = parseUpdateVersionFile(result.stdout);
    if (latest.platform !== updateTarget.platform) {
      throw new Error(
        `latest update platform is ${latest.platform}, expected ${updateTarget.platform}`,
      );
    }
    return latest;
  }

  async function updateInfoPayload(): Promise<Record<string, unknown>> {
    const capability = autoUpdateCapability();
    if (!updateTarget) {
      return {
        current_version: appVersion,
        update_available: false,
        can_auto_update: false,
        reason: capability.reason,
        platform: `${runtime.platform}-${runtime.arch}`,
        source_url: updateArchiveUrl(),
      };
    }
    if (environment.HERDR_GUI_DISABLE_UPDATE_CHECK === "1") {
      return {
        current_version: appVersion,
        update_available: false,
        can_auto_update: false,
        reason: "Update checks are disabled by HERDR_GUI_DISABLE_UPDATE_CHECK.",
        platform: updateTarget.platform,
        source_url: updateArchiveUrl(),
      };
    }
    const latest = await readLatestUpdateVersion();
    return {
      current_version: appVersion,
      latest_version: latest.version,
      update_available: compareVersion(latest.version, appVersion) > 0,
      can_auto_update: capability.canAutoUpdate,
      reason: capability.reason,
      platform: latest.platform,
      source_url: updateArchiveUrl(),
    };
  }

  async function handleUpdateCheck(): Promise<Response> {
    try {
      return Response.json(await updateInfoPayload());
    } catch (e) {
      return Response.json(
        { error: (e as Error).message, source_url: updateArchiveUrl() },
        { status: 502 },
      );
    }
  }

  async function handleUpdateInstall(): Promise<Response> {
    const capability = autoUpdateCapability();
    if (!updateTarget) {
      return Response.json(
        {
          error: capability.reason ?? "Auto update is not available.",
          current_version: appVersion,
          source_url: updateArchiveUrl(),
        },
        { status: 409 },
      );
    }
    if (!capability.canAutoUpdate || !capability.targetPath) {
      return Response.json(
        {
          error: capability.reason ?? "Auto update is not available.",
          current_version: appVersion,
          source_url: updateArchiveUrl(),
        },
        { status: 409 },
      );
    }
    if (updateInstallInProgress) {
      return Response.json(
        {
          error: "An update installation is already in progress.",
          current_version: appVersion,
        },
        { status: 409 },
      );
    }

    updateInstallInProgress = true;
    let waitingForManagedRestart = false;
    try {
      const latest = await readLatestUpdateVersion();
      if (compareVersion(latest.version, appVersion) <= 0) {
        return Response.json({
          ok: true,
          installed: false,
          current_version: appVersion,
          latest_version: latest.version,
          message: "Already up to date.",
        });
      }

      const command = `
set -eu
tmp="$(mktemp -d)"
target=${shQuote(capability.targetPath)}
target_tmp=""
cleanup() {
  rm -rf "$tmp"
  if [ -n "\${target_tmp:-}" ]; then
    rm -f "$target_tmp"
  fi
}
trap cleanup EXIT HUP INT TERM
archive="$tmp/${updateTarget.archiveName}"
checksum="$archive.sha256"
curl -fL ${shQuote(updateArchiveUrl())} -o "$archive"
curl -fL ${shQuote(`${updateArchiveUrl()}.sha256`)} -o "$checksum"
if command -v shasum >/dev/null 2>&1; then
  (cd "$tmp" && shasum -a 256 -c "$(basename "$checksum")")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c "$(basename "$checksum")")
else
  echo "shasum or sha256sum is required to verify updates" >&2
  exit 1
fi
tar -xJf "$archive" -C "$tmp"
version_file="$tmp/${updateTarget.packageDir}/VERSION"
binary="$tmp/${updateTarget.packageDir}/herdr-gui"
test -x "$binary"
expected_version=${shQuote(latest.version)}
actual_version="$(awk '{ print $2 }' "$version_file")"
if [ "$actual_version" != "$expected_version" ]; then
  echo "downloaded VERSION is $actual_version, expected $expected_version" >&2
  exit 1
fi
binary_version="$("$binary" --version | awk '{ print $2 }')"
if [ "$binary_version" != "$expected_version" ]; then
  echo "downloaded binary reports $binary_version, expected $expected_version" >&2
  exit 1
fi
target_dir="$(dirname "$target")"
target_base="$(basename "$target")"
target_tmp="$target_dir/.$target_base.new.$$"
install -m 0755 "$binary" "$target_tmp"
mv -f "$target_tmp" "$target"
target_tmp=""
`;
      const result = await runProcessWithCodeTimeout(
        ["sh", "-c", command],
        UPDATE_INSTALL_TIMEOUT_MS,
      );
      if (result.code !== 0) {
        return Response.json(
          {
            error: (result.stderr || result.stdout || `install exited ${result.code}`)
              .trim()
              .slice(0, 1000),
            current_version: appVersion,
            latest_version: latest.version,
          },
          { status: 500 },
        );
      }
      scheduleManagedExit();
      // Keep the lock until this process exits so another connected client
      // cannot start replacing the binary during the restart grace period.
      waitingForManagedRestart = true;
      return Response.json({
        ok: true,
        installed: true,
        current_version: appVersion,
        installed_version: latest.version,
        restart_required: true,
        restart_scheduled: true,
        restart_mode: "supervisor",
        target_path: capability.targetPath,
      });
    } catch (e) {
      return Response.json(
        { error: (e as Error).message, source_url: updateArchiveUrl() },
        { status: 500 },
      );
    } finally {
      if (!waitingForManagedRestart) updateInstallInProgress = false;
    }
  }

  return { handleUpdateCheck, handleUpdateInstall };
}
