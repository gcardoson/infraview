import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../components/useResource";
import {
  type Cluster,
  type Datastore,
  type DatastoreType,
  type Host,
  buildClusters,
  clusterTotals,
  cores,
  emptySlots,
  formatGb,
  formatTb,
  ghzTotal,
  installedGb,
  maxGb,
  threads,
  useClusterSimulation,
} from "./data";

const pct = (part: number, total: number) => (total ? (part / total) * 100 : 0);
const level = (value: number) => (value >= 85 ? "crit" : value >= 70 ? "warn" : "ok");
const ghz = (value: number) => `${value.toFixed(value >= 100 ? 0 : 1).replace(".", ",")} GHz`;
const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");

const TYPE_FAMILY: Record<DatastoreType, string> = {
  "VMFS 6": "vmfs",
  "VMFS 5": "vmfs",
  "NFS 4.1": "nfs",
  "NFS 3": "nfs",
  vSAN: "vsan",
};

function Meter({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`srv-meter ${className}`}>
      <span className={level(value)} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="srv-tile">
      <span className="srv-tile-label">{label}</span>
      <span className={`srv-tile-value mono ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function Bars({ values }: { values: number[] }) {
  return (
    <span className="srv-bars" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={level(v)} style={{ height: `${Math.max(6, v)}%` }} />
      ))}
    </span>
  );
}

function HostHead({ host, children }: { host: Host; children?: React.ReactNode }) {
  return (
    <div className="srv-host-head">
      <span className="srv-host-dot" aria-hidden />
      <span className="srv-host-name mono">{host.name.split(".")[0]}</span>
      <span className="tag">
        {host.vendor} {host.model}
      </span>
      {children}
    </div>
  );
}

/* ---------- CPU column ---------- */

function CpuColumn({ cluster, selected, onSelect }: ColumnProps) {
  const t = clusterTotals(cluster);
  const used = pct(t.ghzUsed, t.ghz);
  return (
    <section className="panel srv-col">
      <div className="panel-title">
        <span className="srv-col-icon cpu" aria-hidden />
        Processamento · CPU
        <span className="muted">
          {t.cores} cores · {t.threads} threads
        </span>
      </div>

      <div className="srv-summary">
        <div className="srv-summary-main">
          <span className="srv-summary-label">Capacidade do cluster</span>
          <span className="srv-summary-value mono">{ghz(t.ghz)}</span>
          <span className="muted">{ghz(t.ghzUsed)} em uso agora</span>
        </div>
        <div className={`srv-big ${level(used)}`}>
          <span className="srv-big-label">Uso</span>
          <span className="mono">{dec(used)}%</span>
        </div>
      </div>
      <Meter value={used} />
      <div className="srv-tiles four">
        <Tile label="Sockets" value={t.sockets} />
        <Tile label="Cores" value={t.cores} />
        <Tile label="Threads" value={t.threads} />
        <Tile label="vCPU : pCPU" value={`${dec(cluster.vcpus / t.threads)} : 1`} tone={cluster.vcpus / t.threads > 3 ? "warn" : ""} />
      </div>

      <div className="srv-section-title">Hosts</div>
      {cluster.hosts.map((h) => {
        const c = h.cpu;
        return (
          <button key={h.id} className={`srv-host${selected === h.id ? " selected" : ""}`} onClick={() => onSelect(h.id)}>
            <HostHead host={h}>
              <span className={`srv-host-pct mono ${level(h.cpuUsage)}`}>{dec(h.cpuUsage)}%</span>
            </HostHead>
            <div className="srv-cpu-model">
              <span className={`srv-chip ${c.vendor === "AMD" ? "amd" : "intel"}`}>{c.vendor}</span>
              <span>{c.model}</span>
            </div>
            <div className="srv-host-body">
              <dl className="srv-specs">
                <dt>Sockets</dt>
                <dd className="mono">{c.sockets}×</dd>
                <dt>Cores / threads</dt>
                <dd className="mono">
                  {cores(c)} / {threads(c)}
                </dd>
                <dt>Clock</dt>
                <dd className="mono">
                  {dec(c.baseGhz, 2)} – {dec(c.turboGhz, 1)} GHz
                </dd>
                <dt>Cache L3</dt>
                <dd className="mono">{dec(c.cacheMb, c.cacheMb % 1 ? 2 : 0)} MB</dd>
                <dt>Capacidade</dt>
                <dd className="mono">{ghz(ghzTotal(c))}</dd>
              </dl>
              <div className="srv-host-chart">
                <Bars values={h.cpuHistory} />
                <span className="muted">últimos 48 s</span>
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}

/* ---------- memory column ---------- */

function MemoryColumn({ cluster, selected, onSelect }: ColumnProps) {
  const t = clusterTotals(cluster);
  const used = pct(t.ramUsed, t.ram);
  const types = [...new Set(cluster.hosts.map((h) => h.memory.type))].sort().join(" · ");
  return (
    <section className="panel srv-col">
      <div className="panel-title">
        <span className="srv-col-icon ram" aria-hidden />
        Memória · RAM
        <span className="muted">
          {formatGb(t.ram)} de {formatGb(t.ramMax)}
        </span>
      </div>

      <div className="srv-summary">
        <div className="srv-summary-main">
          <span className="srv-summary-label">Instalada no cluster</span>
          <span className="srv-summary-value mono">{formatGb(t.ram)}</span>
          <span className="muted">máximo possível {formatGb(t.ramMax)}</span>
        </div>
        <div className={`srv-big ${level(used)}`}>
          <span className="srv-big-label">Uso</span>
          <span className="mono">{dec(used)}%</span>
        </div>
      </div>
      <div className="srv-capacity" title="Em uso · instalada · máximo possível">
        <span className="installed" style={{ width: `${pct(t.ram, t.ramMax)}%` }}>
          <span className={level(used)} style={{ width: `${used}%` }} />
        </span>
      </div>
      <div className="srv-capacity-legend muted">
        <span>
          <i className="used" /> em uso {formatGb(t.ramUsed)}
        </span>
        <span>
          <i className="installed" /> instalada
        </span>
        <span>
          <i className="max" /> expansão possível {formatGb(t.ramMax - t.ram)}
        </span>
      </div>
      <div className="srv-tiles four">
        <Tile label="Tipos" value={types} />
        <Tile label="Slots" value={t.slots} />
        <Tile label="Ocupados" value={t.slots - t.slotsEmpty} />
        <Tile label="Livres" value={t.slotsEmpty} tone="ok" />
      </div>

      <div className="srv-section-title">Hosts</div>
      {cluster.hosts.map((h) => {
        const m = h.memory;
        const installed = installedGb(m);
        const modules = m.slots.filter((s) => s.sizeGb !== null);
        const sockets = [...new Set(m.slots.map((s) => s.socket))];
        return (
          <button key={h.id} className={`srv-host${selected === h.id ? " selected" : ""}`} onClick={() => onSelect(h.id)}>
            <HostHead host={h}>
              <span className={`srv-host-pct mono ${level(h.memUsage)}`}>{dec(h.memUsage)}%</span>
            </HostHead>
            <div className="srv-cpu-model">
              <span className={`srv-chip ${m.type.toLowerCase()}`}>{m.type}</span>
              <span>
                {m.speedMts} MT/s · {m.form} · {modules.length} × {modules[0]?.sizeGb ?? 0} GB
              </span>
            </div>
            <div className="srv-ram-line">
              <span>
                <b className="mono">{formatGb(installed)}</b> <span className="muted">de {formatGb(maxGb(m))} possíveis</span>
              </span>
              <span className={emptySlots(m) ? "srv-free" : "muted"}>
                {emptySlots(m)} de {m.slots.length} slots livres
              </span>
            </div>
            <div className="srv-dimms">
              {sockets.map((socket) => (
                <div key={socket} className="srv-dimm-row">
                  <span className="srv-dimm-cpu mono">CPU{socket}</span>
                  <span className="srv-dimm-slots">
                    {m.slots
                      .filter((s) => s.socket === socket)
                      .map((s) => (
                        <span
                          key={s.name}
                          className={`srv-dimm${s.sizeGb ? " filled" : ""}`}
                          title={`${s.name}: ${s.sizeGb ? `${s.sizeGb} GB ${m.type}-${m.speedMts}` : `vazio (até ${m.maxModuleGb} GB)`}`}
                        >
                          {s.sizeGb ?? ""}
                        </span>
                      ))}
                  </span>
                </div>
              ))}
            </div>
            <Meter value={h.memUsage} className="thin" />
          </button>
        );
      })}
    </section>
  );
}

/* ---------- storage column ---------- */

function DatastoreRow({ ds, highlight }: { ds: Datastore; highlight: boolean }) {
  const used = pct(ds.usedTb, ds.capacityTb);
  return (
    <li className={`srv-ds${highlight ? " selected" : ""}`}>
      <div className="srv-ds-head">
        <span className="srv-ds-name mono">{ds.name}</span>
        <span className={`srv-chip ${TYPE_FAMILY[ds.type]}`}>{ds.type}</span>
        <span className={`srv-host-pct mono ${level(used)}`}>{dec(used)}%</span>
      </div>
      <Meter value={used} className="thin" />
      <div className="srv-ds-meta muted">
        <span>
          {formatTb(ds.usedTb)} de {formatTb(ds.capacityTb)}
        </span>
        <span>livre {formatTb(ds.capacityTb - ds.usedTb)}</span>
        {!ds.local && <span>{ds.hosts} hosts</span>}
      </div>
      <div className="srv-ds-backing muted">{ds.backing}</div>
    </li>
  );
}

function StorageColumn({ cluster, selected }: ColumnProps) {
  const t = clusterTotals(cluster);
  const used = pct(t.storageUsed, t.storage);
  const shared = cluster.datastores.filter((d) => !d.local);
  const local = cluster.datastores.filter((d) => d.local);
  const byFamily = ["vmfs", "vsan", "nfs"]
    .map((family) => ({
      family,
      tb: shared.filter((d) => TYPE_FAMILY[d.type] === family).reduce((s, d) => s + d.capacityTb, 0),
    }))
    .filter((f) => f.tb > 0);
  const bays = cluster.array.bays;
  const bayCount = (state: string) => bays.filter((b) => b.state === state).length;
  const selectedLocal = selected ? `local-${cluster.hosts.find((h) => h.id === selected)?.name.split(".")[0]}` : null;

  return (
    <section className="panel srv-col">
      <div className="panel-title">
        <span className="srv-col-icon disk" aria-hidden />
        Armazenamento
        <span className="muted">
          {formatTb(t.storageUsed)} de {formatTb(t.storage)}
        </span>
      </div>

      <div className="srv-summary">
        <div className="srv-summary-main">
          <span className="srv-summary-label">Capacidade compartilhada</span>
          <span className="srv-summary-value mono">{formatTb(t.storage)}</span>
          <span className="muted">livre {formatTb(t.storage - t.storageUsed)}</span>
        </div>
        <div className={`srv-big ${level(used)}`}>
          <span className="srv-big-label">Uso</span>
          <span className="mono">{dec(used)}%</span>
        </div>
      </div>
      <div className="srv-types" title="Capacidade por tipo de sistema de arquivos">
        {byFamily.map((f) => (
          <span key={f.family} className={f.family} style={{ flex: f.tb }} />
        ))}
      </div>
      <div className="srv-capacity-legend muted">
        {byFamily.map((f) => (
          <span key={f.family}>
            <i className={f.family} /> {f.family === "vmfs" ? "VMFS" : f.family === "nfs" ? "NFS" : "vSAN"} {formatTb(f.tb)}
          </span>
        ))}
      </div>
      <div className="srv-tiles four">
        <Tile label="Datastores" value={shared.length} />
        <Tile label="Provisionado" value={formatTb(t.provisioned)} />
        <Tile label="Overcommit" value={`${dec(pct(t.provisioned, t.storage), 0)}%`} tone={t.provisioned > t.storage ? "warn" : ""} />
        <Tile label="Locais" value={local.length} />
      </div>

      <div className="srv-section-title">
        {cluster.array.name} · {cluster.array.model}
        <span className="muted">{cluster.array.raid}</span>
      </div>
      <div className="srv-array">
        <div className="srv-bays">
          {bays.map((b) => (
            <span
              key={b.slot}
              className={`srv-bay ${b.state}`}
              title={`Baia ${b.slot}: ${b.state === "empty" ? "vazia" : `${b.kind} ${dec(b.sizeTb ?? 0, 2)} TB · ${b.state === "ok" ? "ok" : b.state === "rebuild" ? "reconstruindo" : "falha"}`}`}
            />
          ))}
        </div>
        <div className="srv-array-legend muted">
          <span>
            <i className="ok" /> {bayCount("ok")} ativos
          </span>
          {bayCount("rebuild") > 0 && (
            <span className="warn-text">
              <i className="rebuild" /> {bayCount("rebuild")} reconstruindo
            </span>
          )}
          <span>
            <i className="empty" /> {bayCount("empty")} baias livres
          </span>
        </div>
      </div>

      <div className="srv-section-title">Datastores</div>
      <ul className="srv-ds-list">
        {shared.map((ds) => (
          <DatastoreRow key={ds.id} ds={ds} highlight={false} />
        ))}
      </ul>
      <div className="srv-section-title">Datastores locais</div>
      <ul className="srv-ds-list">
        {local.map((ds) => (
          <DatastoreRow key={ds.id} ds={ds} highlight={ds.name === selectedLocal} />
        ))}
      </ul>
    </section>
  );
}

interface ColumnProps {
  cluster: Cluster;
  selected: string | null;
  onSelect: (id: string) => void;
}

/* ---------- page ---------- */

export function ServersPage() {
  const [params, setParams] = useSearchParams();
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const clusters = useMemo(() => buildClusters(sites.items), [sites.items]);
  const clusterId = params.get("cluster") ?? clusters[0]?.id;
  const base = sites.loading ? null : (clusters.find((c) => c.id === clusterId) ?? clusters[0] ?? null);
  const cluster = useClusterSimulation(base);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((current) => (current === id ? null : id));

  const t = cluster ? clusterTotals(cluster) : null;
  const rebuilding = cluster?.array.bays.some((b) => b.state === "rebuild");

  return (
    <div className="page srv">
      <div className="page-head">
        <div>
          <div className="eyebrow">Servidores</div>
          <h1>Cluster de virtualização</h1>
        </div>
        <label className="site-picker">
          <span>Cluster</span>
          <select
            value={cluster?.id ?? ""}
            onChange={(e) => {
              setSelected(null);
              setParams({ cluster: e.target.value });
            }}
          >
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.siteName}
              </option>
            ))}
          </select>
        </label>
        <span className="badge sim" title="Hosts, memória e datastores são fictícios até a integração com vCenter, LibreNMS e PRTG">
          Dados fictícios
        </span>
      </div>

      {sites.error && <div className="banner error">Erro ao carregar sites: {sites.error}</div>}

      {cluster && t && (
        <>
          <section className="srv-strip">
            <div className="panel kpi">
              <span className="kpi-label">vCenter</span>
              <span className="srv-strip-text mono">{cluster.vcenter}</span>
            </div>
            <div className="panel kpi">
              <span className="kpi-label">Hosts</span>
              <span className="kpi-value ok">{String(cluster.hosts.length).padStart(2, "0")}</span>
            </div>
            <div className="panel kpi">
              <span className="kpi-label">VMs</span>
              <span className="kpi-value">{t.vms}</span>
            </div>
            <div className="panel kpi">
              <span className="kpi-label">CPU</span>
              <span className={`kpi-value ${level(pct(t.ghzUsed, t.ghz))}`}>{dec(pct(t.ghzUsed, t.ghz))}%</span>
            </div>
            <div className="panel kpi">
              <span className="kpi-label">Memória</span>
              <span className={`kpi-value ${level(pct(t.ramUsed, t.ram))}`}>{dec(pct(t.ramUsed, t.ram))}%</span>
            </div>
            <div className="panel kpi">
              <span className="kpi-label">Armazenamento</span>
              <span className={`kpi-value ${level(pct(t.storageUsed, t.storage))}`}>{dec(pct(t.storageUsed, t.storage))}%</span>
            </div>
            <div className={`panel kpi${rebuilding ? " attention" : ""}`}>
              <span className="kpi-label">HA · DRS</span>
              <span className={`srv-strip-text ${rebuilding ? "warn" : "ok"}`}>
                {rebuilding ? "Disco em rebuild" : `HA ativo · DRS ${cluster.drs.toLowerCase()}`}
              </span>
            </div>
          </section>

          <div className="srv-grid">
            <CpuColumn cluster={cluster} selected={selected} onSelect={toggle} />
            <MemoryColumn cluster={cluster} selected={selected} onSelect={toggle} />
            <StorageColumn cluster={cluster} selected={selected} onSelect={toggle} />
          </div>
          <p className="port-hint muted">Clique em um host para destacá-lo nas três colunas.</p>
        </>
      )}
    </div>
  );
}
