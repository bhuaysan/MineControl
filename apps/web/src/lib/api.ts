import type {
  AuditEntryDto,
  ConnectionTestResult,
  CreateDockerServerRequest,
  CreateExternalServerRequest,
  CreateUserRequest,
  LifecycleAction,
  LoginRequest,
  MeResponse,
  OnlinePlayer,
  PlayerActionRequest,
  PlayerActionResponse,
  SendCommandResponse,
  ServerDto,
  ServerPropertiesDto,
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
