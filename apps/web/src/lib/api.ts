import type {
  ApiTokenDto,
  AuditEntryDto,
  BackupDto,
  ConnectionTestResult,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  FileContentResponse,
  FileListResponse,
  CreateDockerServerRequest,
  CreateExternalServerRequest,
  CreateScheduledTaskRequest,
  CreateUserRequest,
  LifecycleAction,
  LoginRequest,
  MeResponse,
  InstalledModDto,
  MetricSampleDto,
  ModSearchHitDto,
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
  UpdateNotificationSettingsRequest,
  UpdateScheduledTaskRequest,
  UpdateUserRequest,
  UserDto,
} from "@minecontrol/shared";

/** Fehler mit HTTP-Status und Server-Nachricht. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* kein JSON-Body */
    }
    throw new ApiRequestError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  login: (body: LoginRequest) =>
    request<MeResponse>("/api/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),

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
  lifecycleAction: (id: string, action: LifecycleAction) =>
    request<{ ok: true }>(`/api/servers/${id}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ action }),
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
  testNotification: () =>
    request<{ ok: true }>("/api/settings/notifications/test", { method: "POST" }),

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
