import { useState } from "react";
import type { Device, InternetLink, Site } from "./api";
import { ResourcePage, type Field } from "./ResourcePage";

const STATUS_OPTIONS = ["active", "spare", "maintenance", "decommissioned"];
const CATEGORY_OPTIONS = ["firewall", "switch", "access_point", "server", "telephony", "other"];

const siteFields: Field[] = [
  { name: "code", label: "Código", required: true },
  { name: "name", label: "Nome", required: true },
  { name: "city", label: "Cidade" },
  { name: "state", label: "UF" },
];

const deviceFields: Field[] = [
  { name: "site_id", label: "Site (ID)", type: "number", required: true },
  { name: "category", label: "Categoria", options: CATEGORY_OPTIONS, required: true },
  { name: "hostname", label: "Hostname", required: true },
  { name: "management_ip", label: "IP de gerência" },
  { name: "vendor", label: "Fabricante" },
  { name: "model", label: "Modelo" },
  { name: "serial_number", label: "Nº de série" },
  { name: "status", label: "Status", options: STATUS_OPTIONS },
];

const linkFields: Field[] = [
  { name: "site_id", label: "Site (ID)", type: "number", required: true },
  { name: "provider", label: "Operadora", required: true },
  { name: "circuit_id", label: "Circuito" },
  { name: "technology", label: "Tecnologia" },
  { name: "bandwidth_mbps", label: "Banda (Mbps)", type: "number" },
  { name: "public_ip", label: "IP público" },
  { name: "status", label: "Status", options: STATUS_OPTIONS },
];

const TABS = {
  sites: "Sites",
  devices: "Equipamentos",
  links: "Links de internet",
} as const;

type Tab = keyof typeof TABS;

export default function App() {
  const [tab, setTab] = useState<Tab>("sites");

  return (
    <div className="app">
      <header>
        <h1>InfraView</h1>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((key) => (
            <button key={key} className={key === tab ? "active" : ""} onClick={() => setTab(key)}>
              {TABS[key]}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "sites" && (
          <ResourcePage<Site>
            key="sites"
            resource="sites"
            fields={siteFields}
            columns={["id", "code", "name", "city", "state"]}
          />
        )}
        {tab === "devices" && (
          <ResourcePage<Device>
            key="devices"
            resource="devices"
            fields={deviceFields}
            columns={["id", "site_id", "category", "hostname", "management_ip", "vendor", "model", "status"]}
          />
        )}
        {tab === "links" && (
          <ResourcePage<InternetLink>
            key="links"
            resource="links"
            fields={linkFields}
            columns={["id", "site_id", "provider", "circuit_id", "bandwidth_mbps", "public_ip", "status"]}
          />
        )}
      </main>
    </div>
  );
}
