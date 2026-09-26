// Simplified Chinese messages for the core group; keys are the English source.
export default {
  // Updates
  "Roamgate {version} is running": "Roamgate {version} 正在运行",
  "Reloading the application to use the updated frontend.":
    "正在重新加载应用以使用更新后的前端。",
  "Updated server did not become ready": "更新后的服务器未能就绪",
  "Could not verify Roamgate {version}. Reload the page after checking the server process.":
    "无法确认 Roamgate {version} 已运行。请检查服务器进程后重新加载页面。",
  "Resume the connection before checking for updates.":
    "请先恢复连接，再检查更新。",
  "Update check failed": "检查更新失败",
  "Roamgate is up to date": "Roamgate 已是最新版本",
  "Current version: {version}": "当前版本：{version}",
  "Resume the connection before installing updates.":
    "请先恢复连接，再安装更新。",
  "Restarting the Roamgate process": "正在重启 Roamgate 进程",
  "The binary was updated. Waiting for the external process supervisor to start the new version.":
    "程序已更新，正在等待外部进程管理器启动新版本。",
  "Roamgate {version} installed": "Roamgate {version} 已安装",
  "Restart the Roamgate process to use the new version.":
    "重启 Roamgate 进程以使用新版本。",
  "Roamgate is already up to date": "Roamgate 已是最新版本",
  "Update install failed": "安装更新失败",

  // Task notifications
  "workspace {name}": "工作区 {name}",
  "tab {name}": "标签页 {name}",
  "Task notifications are unavailable": "任务通知不可用",
  "Enable notifications for this site in the browser settings, then try again.":
    "请在浏览器设置中允许此网站发送通知，然后重试。",
  "Roamgate agent needs input": "Roamgate Agent 需要输入",
  "Roamgate task completed": "Roamgate 任务已完成",
  "Agent needs input": "Agent 需要输入",
  "Task completed": "任务已完成",
  "Open agent": "打开 Agent",
  "Open workspace": "打开工作区",
  "Background notification sync failed": "后台通知同步失败",
  "Notification preference was not saved": "通知偏好未保存",
  "Notification revocation failed": "撤销通知失败",
  "Task notifications disabled on this device": "已在此设备上关闭任务通知",
  "Browser notifications are not supported": "浏览器不支持通知",
  "Use a browser with notification support over HTTPS. On iPhone or iPad, open Roamgate from the Home Screen (iOS/iPadOS 16.4 or later).":
    "请通过 HTTPS 使用支持通知的浏览器。在 iPhone 或 iPad 上，请从主屏幕打开 Roamgate（需要 iOS/iPadOS 16.4 或更高版本）。",
  "Notification permission failed": "请求通知权限失败",
  "Task notifications enabled": "已开启任务通知",
  "This device receives completion and input-required notifications even when Roamgate is closed, subject to your platform settings.":
    "即使 Roamgate 已关闭，此设备也会收到任务完成和需要输入的通知（取决于系统设置）。",
  "Local notifications work while this page is running. Background delivery requires Web Push support and server configuration.":
    "本地通知仅在此页面运行时有效。后台推送需要 Web Push 支持并在服务器上完成配置。",
  "Notification permission was not granted": "未获得通知权限",
  "Unable to update background notifications. Check the server connection and try again.":
    "无法更新后台通知。请检查与服务器的连接后重试。",
  "The browser could not revoke its push subscription. Try again.":
    "浏览器无法撤销推送订阅，请重试。",
  "Unable to disable the previous push subscription.":
    "无法停用之前的推送订阅。",
  "Unable to replace the previous push subscription.":
    "无法替换之前的推送订阅。",
  "The notification service worker could not activate.":
    "通知 Service Worker 无法激活。",
  "The notification service worker did not become ready. Check the connection and try again.":
    "通知 Service Worker 未能就绪。请检查连接后重试。",

  // Connection
  "Connection is paused": "连接已暂停",
  "Resume the connection before sending actions to Herdr.":
    "请先恢复连接，再向 Herdr 发送操作。",
  "Browser reconnected": "浏览器已重新连接",
  "Browser sync resumed": "浏览器同步已恢复",
  "Another Roamgate client paused this connection. Resume when you want this browser to sync again.":
    "另一个 Roamgate 客户端暂停了此连接。需要此浏览器重新同步时，请恢复连接。",
  "This browser will stop syncing until you resume it.":
    "此浏览器将停止同步，直到你恢复连接。",
  "Connection paused": "连接已暂停",
  "Paused 1 other browser": "已暂停另外 1 个浏览器",
  "Paused {count} other browsers": "已暂停另外 {count} 个浏览器",
  "Reconnecting browser": "正在重新连接浏览器",
  "Resuming browser sync": "正在恢复浏览器同步",
  "Could not log out. Please try again.": "无法退出登录，请重试。",
  "Endpoint availability is loading. Open the source terminal and wait for it to connect.":
    "正在加载端点可用性。请打开源终端并等待其连接。",
  "Herdr endpoint does not advertise {method}": "Herdr 端点未声明支持 {method}",

  // Connection profiles
  Local: "本地",
  "SSH destination must be an OpenSSH alias or user@host. Use an OpenSSH config alias for custom ports.":
    "SSH 目标必须是 OpenSSH 别名或 user@host。如需自定义端口，请使用 OpenSSH 配置中的别名。",
  "{field} path must be a short absolute POSIX path.":
    "{field}路径必须是较短的 POSIX 绝对路径。",
  "ID must start with a letter or number and use only letters, numbers, dot, colon, underscore, or hyphen.":
    "ID 必须以字母或数字开头，且只能包含字母、数字、点、冒号、下划线或连字符。",
  "Label must be 1-80 printable characters.":
    "名称必须为 1 到 80 个可打印字符。",
  "Control socket": "控制套接字",
  "Render socket": "渲染套接字",
  "{field} path must be an absolute socket path without parent traversal.":
    "{field}路径必须是绝对套接字路径，且不能包含上级目录（..）。",
  "Remote control socket": "远程控制套接字",
  "Remote render socket": "远程渲染套接字",
  "Remote control and render socket paths must differ.":
    "远程控制套接字与渲染套接字的路径不能相同。",
  "Connection operation failed": "连接操作失败",

  // Pane control
  "Another collaborator": "另一位协作者",
  "This pane is view only. Take control to send input.":
    "此窗格为只读。请接管控制后再发送输入。",
  "Layout control is temporarily held by another collaborator. Try again when its protection ends.":
    "布局控制权暂时由另一位协作者持有。请在其保护期结束后重试。",

  // Workspaces and tabs
  "Tab created, but naming failed": "标签页已创建，但命名失败",
  "Tab creation failed": "创建标签页失败",
  "Workspace creation failed": "创建工作区失败",
  "Workspace belongs to a group": "工作区属于一个分组",
  "Workspace close failed": "关闭工作区失败",
  "Nothing was closed. To close this workspace and its linked workspaces, explicitly close the group in the Herdr CLI with --group.":
    "未关闭任何内容。如需关闭此工作区及其关联的工作区，请在 Herdr CLI 中使用 --group 显式关闭该分组。",

  // Git
  "Running git pull": "正在运行 git pull",
  Command: "命令",
  "Git pull completed": "git pull 已完成",
  "Already up to date.": "已是最新。",
  "Git pull failed": "git pull 失败",
  "{action} failed": "{action}失败",
  "{message} (1 file)": "{message}（1 个文件）",
  "{message} ({count} files)": "{message}（{count} 个文件）",
  "{completed} of {total} files completed. {error}":
    "已完成 {completed}/{total} 个文件。{error}",
  "Git action failed": "Git 操作失败",

  // Worktrees
  "Worktree teardown hook": "工作树清理钩子",
  "Worktree opened hook": "工作树打开钩子",
  "Worktree removed hook": "工作树移除钩子",
  "Worktree setup hook": "工作树设置钩子",
  "{hook} completed": "{hook}已完成",
  "{hook} failed (exit {code})": "{hook}失败（退出码 {code}）",
  "{hook} failed": "{hook}失败",
  "{hook} output": "{hook}输出",
  "Stopped 1 process still using the checkout.":
    "已停止 1 个仍在使用该检出目录的进程。",
  "Stopped {count} processes still using the checkout.":
    "已停止 {count} 个仍在使用该检出目录的进程。",
  "Stale files were preserved at {path}.": "残留文件已保留在 {path}。",
  "The checkout was already absent; stale Herdr state was reconciled.":
    "检出目录已不存在，已清理 Herdr 中的残留状态。",
  "Worktree removed with cleanup warning": "工作树已移除，但清理时出现警告",
  "Worktree removal details": "工作树移除详情",
  "Worktree removed": "工作树已移除",
  "Creating worktree": "正在创建工作树",
  "Updating origin's default branch before creating {branch}.":
    "正在更新 origin 的默认分支，然后创建 {branch}。",
  "Fetch origin's default branch": "获取 origin 的默认分支",
  "origin's default branch": "origin 的默认分支",
  "Worktree created": "工作树已创建",
  "{branch} starts from {base} at {commit}.":
    "{branch} 基于 {base} 的 {commit} 创建。",
  "{branch} starts from the latest {base}.":
    "{branch} 基于最新的 {base} 创建。",
  "Failed to create worktree": "创建工作树失败",
  "Removing worktree": "正在移除工作树",
  "Running teardown hook if configured.": "正在运行清理钩子（如已配置）。",
  "Failed to remove worktree": "移除工作树失败",
  "Automatic branch updates enabled": "已开启分支自动更新",
  "Automatic branch updates disabled": "已关闭分支自动更新",
  "A sync will run now, then every 10 minutes while this workspace remains open.":
    "将立即同步一次，之后在此工作区保持打开期间每 10 分钟同步一次。",
  "Failed to update automatic sync settings": "更新自动同步设置失败",
} satisfies Record<string, string>;
