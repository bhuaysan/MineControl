import type {
  ApiTokenDto,
  AuditEntryDto,
  BackupDto,
  ConnectionTestResult,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  FileContentResponse,
  FileListResponse,
  ImportSourceDto,
  StageUploadResponse,
  CreateDockerServerRequest,
  CreateExternalServerRequest,
  CreateScheduledTaskRequest,
  CreateUserRequest,
  LifecycleAction,
  LoginRequest,
  MeResponse,
  InstalledModDto,
  PluginConfigFileDto,
  PluginConfigListDto,
  PluginUpdateDto,
  LpGroupDetailDto,
  LpGroupSummaryDto,
  LpSetMetaRequest,
  LpUserDto,
  LuckPermsInstallResponse,
  LuckPermsStatusDto,
  MetricSampleDto,
  ModSearchHitDto,
  AddSubserverRequest,
  CreateNetworkRequest,
  NetworkDto,
  CreateWorldRequest,
  PregenRequest,
  PregenResponse,
  WorldListResponse,
  NotificationChannel,
  NotificationSettingsDto,
  OnlinePlayer,
  PlayerListItemDto,
  PlayerProfileDto,
  PlayerActionRequest,
  PlayerActionResponse,
  ScheduledTaskDto,
  SendCommandResponse,
  ServerDto,
  ServerPropertiesDto,
  TwoFactorSetupResponse,
  UpdateNotificationSettingsRequest,
  UpdateScheduledTaskRequest,
  UpdateUserRequest,
  UserDto,
} from "@minecontrol/shared";

/** Fehler mit HTTP-Status, Server-Nachricht und (optional) Fehler-Code. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type nur setzen, wenn es tatsächlich einen JSON-Body gibt. Sonst
  // lehnt Fastify body-lose Requests (DELETE, body-lose POSTs) ab:
  // „Body cannot be empty when content-type is set to 'application/json'".
  const hasBody = init?.body != null;
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      if (body.message) message = body.message;
      code = body.error;
    } catch {
      /* kein JSON-Body */
    }
    throw new ApiRequestError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  login: (body: LoginRequest) =>
    request<MeResponse>("/api/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),

  // Zwei-Faktor-Authentifizierung (TOTP)
  twoFactorStatus: () => request<{ enabled: boolean }>("/api/2fa/status"),
  twoFactorSetup: () =>
    request<TwoFactorSetupResponse>("/api/2fa/setup", { method: "POST" }),
  twoFactorEnable: (code: string) =>
    request<{ enabled: boolean }>("/api/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  twoFactorDisable: (code: string) =>
    request<{ enabled: boolean }>("/api/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  listServers: () => request<ServerDto[]>("/api/servers"),
  getServer: (id: string) => request<ServerDto>(`/api/servers/${id}`),
  createExternalServer: (body: CreateExternalServerRequest) =>
    request<ServerDto>("/api/servers/external", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createDockerServer: (body: CreateDockerServerRequest) =>
    request<ServerDto>("/api/servers/docker", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listImportSources: () => request<ImportSourceDto[]>("/api/servers/import/sources"),
  /**
   * Lädt ein Import-Archiv ins Staging hoch und liefert die stagingId. Nutzt
   * XMLHttpRequest für Fortschritt (0..1) bei großen Dateien.
   */
  stageImport: (file: File, onProgress?: (fraction: number) => void) =>
    new Promise<StageUploadResponse>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/servers/import/stage");
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as StageUploadResponse);
        } else {
          let message = xhr.statusText;
          try {
            const body = JSON.parse(xhr.responseText) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            /* kein JSON */
          }
          reject(new ApiRequestError(xhr.status, message));
        }
      };
      xhr.onerror = () => reject(new ApiRequestError(0, "Upload fehlgeschlagen"));
      xhr.send(form);
    }),
  lifecycleAction: (id: string, action: LifecycleAction) =>
    request<{ ok: true }>(`/api/servers/${id}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  setAutoRestart: (id: string, enabled: boolean) =>
    request<ServerDto>(`/api/servers/${id}/auto-restart`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  getProperties: (id: string) =>
    request<ServerPropertiesDto>(`/api/servers/${id}/properties`),
  updateProperties: (id: string, properties: Record<string, string>) =>
    request<ServerPropertiesDto>(`/api/servers/${id}/properties`, {
      method: "PUT",
      body: JSON.stringify({ properties }),
    }),
  testConnection: (body: {
    host: string;
    port: number;
    rconPort?: number;
    rconPassword?: string;
  }) =>
    request<ConnectionTestResult>("/api/servers/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteServer: (id: string, keepWorld = false) =>
    request<{ ok: true }>(
      `/api/servers/${id}${keepWorld ? "?keepWorld=true" : ""}`,
      { method: "DELETE" },
    ),
  sendCommand: (id: string, command: string) =>
    request<SendCommandResponse>(`/api/servers/${id}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    }),
  getPlayers: (id: string) =>
    request<OnlinePlayer[]>(`/api/servers/${id}/players`),
  playerAction: (id: string, body: PlayerActionRequest) =>
    request<PlayerActionResponse>(`/api/servers/${id}/players/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Backups
  listBackups: (id: string) => request<BackupDto[]>(`/api/servers/${id}/backups`),
  createBackup: (id: string) =>
    request<BackupDto>(`/api/servers/${id}/backups`, { method: "POST" }),
  restoreBackup: (id: string, backupId: string) =>
    request<{ ok: true }>(`/api/servers/${id}/backups/${backupId}/restore`, {
      method: "POST",
    }),
  deleteBackup: (id: string, backupId: string) =>
    request<{ ok: true }>(`/api/servers/${id}/backups/${backupId}`, {
      method: "DELETE",
    }),

  // Geplante Tasks
  listTasks: (id: string) => request<ScheduledTaskDto[]>(`/api/servers/${id}/tasks`),
  createTask: (id: string, body: CreateScheduledTaskRequest) =>
    request<ScheduledTaskDto>(`/api/servers/${id}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTask: (id: string, taskId: string, body: UpdateScheduledTaskRequest) =>
    request<ScheduledTaskDto>(`/api/servers/${id}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: (id: string, taskId: string) =>
    request<{ ok: true }>(`/api/servers/${id}/tasks/${taskId}`, { method: "DELETE" }),
  runTask: (id: string, taskId: string) =>
    request<ScheduledTaskDto>(`/api/servers/${id}/tasks/${taskId}/run`, {
      method: "POST",
    }),

  // Datei-Manager
  listFiles: (id: string, path: string) =>
    request<FileListResponse>(
      `/api/servers/${id}/files?path=${encodeURIComponent(path)}`,
    ),
  readFile: (id: string, path: string) =>
    request<FileContentResponse>(
      `/api/servers/${id}/files/content?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (id: string, path: string, content: string) =>
    request<{ ok: true }>(`/api/servers/${id}/files/content`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),
  makeDir: (id: string, path: string) =>
    request<{ ok: true }>(`/api/servers/${id}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  deleteFile: (id: string, path: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/files?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  uploadFile: async (id: string, dir: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/servers/${id}/files/upload?path=${encodeURIComponent(dir)}`,
      { method: "POST", credentials: "include", body: form },
    );
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* kein JSON */
      }
      throw new ApiRequestError(res.status, message);
    }
  },
  downloadFileUrl: (id: string, path: string) =>
    `/api/servers/${id}/files/download?path=${encodeURIComponent(path)}`,
  worldDownloadUrl: (id: string) => `/api/servers/${id}/world/download`,

  // Welt-Verwaltung
  listWorlds: (id: string) => request<WorldListResponse>(`/api/servers/${id}/worlds`),
  switchWorld: (id: string, name: string) =>
    request<{ ok: true }>(`/api/servers/${id}/worlds/switch`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  createWorld: (id: string, body: CreateWorldRequest) =>
    request<{ ok: true }>(`/api/servers/${id}/worlds`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteWorld: (id: string, name: string) =>
    request<{ ok: true }>(`/api/servers/${id}/worlds/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  uploadWorld: async (id: string, name: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/servers/${id}/worlds/upload?name=${encodeURIComponent(name)}`,
      { method: "POST", credentials: "include", body: form },
    );
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* kein JSON */
      }
      throw new ApiRequestError(res.status, message);
    }
  },
  startPregen: (id: string, body: PregenRequest) =>
    request<PregenResponse>(`/api/servers/${id}/worlds/pregen`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelPregen: (id: string) =>
    request<{ response: string }>(`/api/servers/${id}/worlds/pregen/cancel`, {
      method: "POST",
    }),

  // Plugins/Mods (Modrinth)
  searchMods: (id: string, q: string) =>
    request<ModSearchHitDto[]>(
      `/api/servers/${id}/mods/search?q=${encodeURIComponent(q)}`,
    ),
  listMods: (id: string) => request<InstalledModDto[]>(`/api/servers/${id}/mods`),
  installMod: (id: string, projectId: string) =>
    request<{ filename: string }>(`/api/servers/${id}/mods/install`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  deleteMod: (id: string, file: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/mods?file=${encodeURIComponent(file)}`,
      { method: "DELETE" },
    ),
  installModFromUrl: (id: string, url: string) =>
    request<{ filename: string }>(`/api/servers/${id}/mods/from-url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  uploadMod: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/servers/${id}/mods/upload`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* kein JSON */
      }
      throw new ApiRequestError(res.status, message);
    }
    return (await res.json()) as { filename: string };
  },
  toggleMod: (id: string, file: string, enabled: boolean) =>
    request<{ ok: true }>(`/api/servers/${id}/mods/toggle`, {
      method: "POST",
      body: JSON.stringify({ file, enabled }),
    }),
  modUpdates: (id: string) =>
    request<PluginUpdateDto[]>(`/api/servers/${id}/mods/updates`),
  updateMod: (id: string, file: string) =>
    request<{ filename: string }>(`/api/servers/${id}/mods/update`, {
      method: "POST",
      body: JSON.stringify({ file }),
    }),
  pluginConfig: (id: string, file: string) =>
    request<PluginConfigListDto>(
      `/api/servers/${id}/mods/config?file=${encodeURIComponent(file)}`,
    ),
  readPluginConfig: (id: string, file: string, path: string) =>
    request<PluginConfigFileDto>(
      `/api/servers/${id}/mods/config/file?file=${encodeURIComponent(file)}&path=${encodeURIComponent(path)}`,
    ),
  writePluginConfig: (id: string, file: string, path: string, content: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/mods/config/file?file=${encodeURIComponent(file)}&path=${encodeURIComponent(path)}`,
      { method: "PUT", body: JSON.stringify({ content }) },
    ),

  // LuckPerms (Berechtigungen)
  lpStatus: (id: string) =>
    request<LuckPermsStatusDto>(`/api/servers/${id}/luckperms`),
  lpInstall: (id: string) =>
    request<LuckPermsInstallResponse>(`/api/servers/${id}/luckperms/install`, {
      method: "POST",
    }),
  lpListGroups: (id: string) =>
    request<LpGroupSummaryDto[]>(`/api/servers/${id}/luckperms/groups`),
  lpCreateGroup: (id: string, name: string) =>
    request<{ ok: true }>(`/api/servers/${id}/luckperms/groups`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  lpDeleteGroup: (id: string, name: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/groups/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  lpGetGroup: (id: string, name: string) =>
    request<LpGroupDetailDto>(
      `/api/servers/${id}/luckperms/groups/${encodeURIComponent(name)}`,
    ),
  lpSetGroupPermission: (id: string, name: string, node: string, value: boolean) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/groups/${encodeURIComponent(name)}/permission`,
      { method: "POST", body: JSON.stringify({ node, value }) },
    ),
  lpUnsetGroupPermission: (id: string, name: string, node: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/groups/${encodeURIComponent(name)}/permission?node=${encodeURIComponent(node)}`,
      { method: "DELETE" },
    ),
  lpSetGroupMeta: (id: string, name: string, body: LpSetMetaRequest) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/groups/${encodeURIComponent(name)}/meta`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  lpGetUser: (id: string, name: string) =>
    request<LpUserDto>(
      `/api/servers/${id}/luckperms/users/${encodeURIComponent(name)}`,
    ),
  lpAddUserGroup: (id: string, name: string, group: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/users/${encodeURIComponent(name)}/groups`,
      { method: "POST", body: JSON.stringify({ group }) },
    ),
  lpRemoveUserGroup: (id: string, name: string, group: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/users/${encodeURIComponent(name)}/groups/${encodeURIComponent(group)}`,
      { method: "DELETE" },
    ),
  lpSetUserPermission: (id: string, name: string, node: string, value: boolean) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/users/${encodeURIComponent(name)}/permission`,
      { method: "POST", body: JSON.stringify({ node, value }) },
    ),
  lpUnsetUserPermission: (id: string, name: string, node: string) =>
    request<{ ok: true }>(
      `/api/servers/${id}/luckperms/users/${encodeURIComponent(name)}/permission?node=${encodeURIComponent(node)}`,
      { method: "DELETE" },
    ),

  // Metrik-Historie
  metricHistory: (id: string, range: string) =>
    request<MetricSampleDto[]>(`/api/servers/${id}/metrics/history?range=${range}`),

  // Benachrichtigungen
  getNotificationSettings: () =>
    request<NotificationSettingsDto>("/api/settings/notifications"),
  updateNotificationSettings: (body: UpdateNotificationSettingsRequest) =>
    request<NotificationSettingsDto>("/api/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testNotification: (channel: NotificationChannel) =>
    request<{ ok: true }>("/api/settings/notifications/test", {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),

  // Spieler-Profile
  listPlayers: () => request<PlayerListItemDto[]>("/api/players"),
  getPlayer: (key: string) =>
    request<PlayerProfileDto>(`/api/players/${encodeURIComponent(key)}`),
  updatePlayerNotes: (key: string, notes: string) =>
    request<PlayerProfileDto>(`/api/players/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),

  // API-Tokens
  listTokens: () => request<ApiTokenDto[]>("/api/tokens"),
  createToken: (body: CreateApiTokenRequest) =>
    request<CreateApiTokenResponse>("/api/tokens", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeToken: (id: string) =>
    request<{ ok: true }>(`/api/tokens/${id}`, { method: "DELETE" }),

  // Velocity-Netzwerke
  listNetworks: () => request<NetworkDto[]>("/api/networks"),
  getNetwork: (id: string) => request<NetworkDto>(`/api/networks/${id}`),
  createNetwork: (body: CreateNetworkRequest) =>
    request<NetworkDto>("/api/networks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addSubserver: (id: string, body: AddSubserverRequest) =>
    request<NetworkDto>(`/api/networks/${id}/subservers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  detachSubserver: (id: string, serverId: string) =>
    request<{ ok: true }>(`/api/networks/${id}/subservers/${serverId}`, {
      method: "DELETE",
    }),
  deleteNetwork: (id: string) =>
    request<{ ok: true }>(`/api/networks/${id}`, { method: "DELETE" }),

  listAudit: () => request<AuditEntryDto[]>("/api/audit"),

  listUsers: () => request<UserDto[]>("/api/users"),
  createUser: (body: CreateUserRequest) =>
    request<UserDto>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: UpdateUserRequest) =>
    request<UserDto>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteUser: (id: string) =>
    request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
};
