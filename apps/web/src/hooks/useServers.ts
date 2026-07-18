import type { ServerDto } from "@minecontrol/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export const serversQueryKey = ["servers"] as const;

export function useServers() {
  return useQuery<ServerDto[]>({
    queryKey: serversQueryKey,
    queryFn: api.listServers,
  });
}
