export type LifecycleStatus = "active" | "spare" | "maintenance" | "decommissioned";
export type LinkRole = "primary" | "secondary" | "backup";

export interface Site {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface Vlan {
  vlan_id: number;
  name: string | null;
  subnet: string | null;
}

export interface InternetLink {
  id: number;
  site_id: number;
  provider: string;
  circuit_id: string | null;
  technology: string | null;
  bandwidth_mbps: number | null;
  role: LinkRole;
  public_ip: string | null;
  netmask: string | null;
  gateway_ip: string | null;
  nat_enabled: boolean;
  sdwan_device: string | null;
  sdwan_port: string | null;
  vlans: Vlan[];
  status: LifecycleStatus;
  notes: string | null;
}

/* A VLAN in a site's register (the VLAN catalogue screen), unlike Vlan which a link lists. */
export interface SiteVlan {
  id: number;
  site_id: number;
  vlan_id: number;
  name: string;
  subnet: string | null;
  gateway_ip: string | null;
  dhcp: boolean;
  status: LifecycleStatus;
  notes: string | null;
}

export type SitePayload = Omit<Site, "id">;
export type VlanPayload = Omit<SiteVlan, "id">;
export type LinkPayload = Omit<InternetLink, "id">;

interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
}

export class ApiError extends Error {}

function describeError(body: { detail?: string | ValidationIssue[] }, fallback: string): string {
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail.map((issue) => `${issue.loc.slice(1).join(".")}: ${issue.msg}`).join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(describeError(body, response.statusText));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function crud<T, P>(resource: string) {
  return {
    list: (params: Record<string, string | number> = {}) => {
      const query = new URLSearchParams({ limit: "1000", ...params } as Record<string, string>);
      return request<T[]>(`/${resource}?${query}`);
    },
    create: (payload: P) => request<T>(`/${resource}`, { method: "POST", body: JSON.stringify(payload) }),
    update: (id: number, payload: Partial<P>) =>
      request<T>(`/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id: number) => request<void>(`/${resource}/${id}`, { method: "DELETE" }),
  };
}

export const api = {
  sites: crud<Site, SitePayload>("sites"),
  links: crud<InternetLink, LinkPayload>("links"),
  vlans: crud<SiteVlan, VlanPayload>("vlans"),
};

export const ROLE_LABEL: Record<LinkRole, string> = {
  primary: "Principal",
  secondary: "Secundário",
  backup: "Backup",
};

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  active: "Ativo",
  spare: "Reserva",
  maintenance: "Manutenção",
  decommissioned: "Desativado",
};
