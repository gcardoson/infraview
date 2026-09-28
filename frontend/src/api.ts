export type LifecycleStatus = "active" | "spare" | "maintenance" | "decommissioned";
export type DeviceCategory = "firewall" | "switch" | "access_point" | "server" | "telephony" | "other";

export interface Site {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
}

export interface Device {
  id: number;
  site_id: number;
  category: DeviceCategory;
  hostname: string;
  management_ip: string | null;
  vendor: string | null;
  model: string | null;
  serial_number: string | null;
  status: LifecycleStatus;
}

export interface InternetLink {
  id: number;
  site_id: number;
  provider: string;
  circuit_id: string | null;
  technology: string | null;
  bandwidth_mbps: number | null;
  public_ip: string | null;
  status: LifecycleStatus;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : response.statusText;
    throw new Error(detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  list: <T>(resource: string) => request<T[]>(`/${resource}`),
  create: <T>(resource: string, payload: object) =>
    request<T>(`/${resource}`, { method: "POST", body: JSON.stringify(payload) }),
  remove: (resource: string, id: number) => request<void>(`/${resource}/${id}`, { method: "DELETE" }),
};
