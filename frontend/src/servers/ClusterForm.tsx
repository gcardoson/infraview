import { type FormEvent, useState } from "react";
import { type ClusterDocument, type ClusterPayload, type ClusterRecord, type Site, api } from "../api";
import { Modal } from "../components/Modal";
import { type BayState, type DatastoreType, type DimmSlot, type MemoryInfo, TEMPLATES, type StorageArray } from "./data";

type HostDoc = ClusterDocument["hosts"][number];
type DatastoreDoc = ClusterDocument["datastores"][number];

const DATASTORE_TYPES: DatastoreType[] = ["VMFS 6", "VMFS 5", "NFS 4.1", "NFS 3", "vSAN"];
const DISK_KINDS: StorageArray["bays"][number]["kind"][] = ["NVMe", "SSD", "HDD"];

/* Memory as the form edits it: slots per socket and how many hold a module of one size. */
interface MemoryDraft {
  type: MemoryInfo["type"];
  speedMts: number;
  form: MemoryInfo["form"];
  maxModuleGb: number;
  perSocket: number;
  filledPerSocket: number;
  moduleGb: number;
}

function memoryDraft(m: MemoryInfo, sockets: number): MemoryDraft {
  const perSocket = Math.max(1, Math.round(m.slots.length / Math.max(1, sockets)));
  const filled = m.slots.filter((s) => s.sizeGb !== null);
  return {
    type: m.type,
    speedMts: m.speedMts,
    form: m.form,
    maxModuleGb: m.maxModuleGb,
    perSocket,
    filledPerSocket: Math.round(filled.length / Math.max(1, sockets)),
    moduleGb: filled[0]?.sizeGb ?? 32,
  };
}

/* Slots A1…An on socket 1, B1…Bn on socket 2, filled from the first one, like the server's manual. */
function slotsOf(d: MemoryDraft, sockets: number): DimmSlot[] {
  const slots: DimmSlot[] = [];
  for (let socket = 1; socket <= sockets; socket++) {
    const letter = String.fromCharCode(64 + socket);
    for (let n = 1; n <= d.perSocket; n++) slots.push({ name: `${letter}${n}`, socket, sizeGb: n <= d.filledPerSocket ? d.moduleGb : null });
  }
  return slots;
}

interface ArrayDraft {
  name: string;
  model: string;
  raid: string;
  bays: number;
  filled: number;
  kind: StorageArray["bays"][number]["kind"];
  sizeTb: number;
}

function arrayDraft(a: StorageArray | null): ArrayDraft {
  const filled = a?.bays.filter((b) => b.state !== "empty") ?? [];
  return {
    name: a?.name ?? "",
    model: a?.model ?? "",
    raid: a?.raid ?? "",
    bays: a?.bays.length ?? 0,
    filled: filled.length,
    kind: filled[0]?.kind ?? a?.bays[0]?.kind ?? "SSD",
    sizeTb: filled[0]?.sizeTb ?? 1.92,
  };
}

function arrayOf(d: ArrayDraft): StorageArray | null {
  if (!d.name.trim() && !d.bays) return null;
  return {
    name: d.name.trim(),
    model: d.model.trim(),
    raid: d.raid.trim(),
    bays: Array.from({ length: d.bays }, (_, slot) => ({
      slot,
      state: (slot < d.filled ? "ok" : "empty") as BayState,
      sizeTb: slot < d.filled ? d.sizeTb : null,
      kind: d.kind,
    })),
  };
}

function hostFromTemplate(key: string, name: string): { host: HostDoc; memory: MemoryDraft } {
  const t = TEMPLATES[key];
  const memory: MemoryDraft = { ...t.memory, filledPerSocket: t.filledPerSocket, moduleGb: t.moduleGb };
  return {
    host: {
      name,
      vendor: t.vendor,
      model: t.model,
      serial: "",
      hypervisor: "ESXi 8.0 U3",
      state: "connected",
      vms: 0,
      cpu: { ...t.cpu },
      memory: { type: t.memory.type, speedMts: t.memory.speedMts, form: t.memory.form, maxModuleGb: t.memory.maxModuleGb, slots: slotsOf(memory, t.cpu.sockets) },
    },
    memory,
  };
}

interface Props {
  cluster: ClusterRecord | null;
  sites: Site[];
  onClose: () => void;
  onSaved: (cluster: ClusterRecord) => void;
}

/* Creates or edits a site's cluster: general data, hosts (CPU and memory), datastores and storage array. */
export function ClusterForm({ cluster, sites, onClose, onSaved }: Props) {
  const doc = cluster?.document;
  const [siteId, setSiteId] = useState(String(cluster?.site_id ?? sites[0]?.id ?? ""));
  const site = sites.find((s) => s.id === Number(siteId));
  const short = (site?.code ?? "").replace(/^BR-/, "").toLowerCase();
  const [general, setGeneral] = useState({
    name: cluster?.name ?? "",
    vcenter: cluster?.vcenter ?? "",
    ha: cluster?.ha_enabled ?? true,
    drs: cluster?.drs ?? "Automático",
    vcpus: doc?.vcpus ? String(doc.vcpus) : "",
  });
  const [hosts, setHosts] = useState<HostDoc[]>(doc?.hosts ?? []);
  const [memory, setMemory] = useState<MemoryDraft[]>(() => (doc?.hosts ?? []).map((h) => memoryDraft(h.memory, h.cpu.sockets)));
  const [datastores, setDatastores] = useState<DatastoreDoc[]>(doc?.datastores ?? []);
  const [array, setArray] = useState<ArrayDraft>(() => arrayDraft(doc?.array ?? null));
  const [open, setOpen] = useState<number | null>(null);
  const [template, setTemplate] = useState("r750");
  const [error, setError] = useState<string | null>(null);

  const setHost = (i: number, patch: Partial<HostDoc>) => setHosts(hosts.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const setCpu = (i: number, patch: Partial<HostDoc["cpu"]>) => setHost(i, { cpu: { ...hosts[i].cpu, ...patch } });
  const setMem = (i: number, patch: Partial<MemoryDraft>) => setMemory(memory.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const setStore = (i: number, patch: Partial<DatastoreDoc>) => setDatastores(datastores.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const addHost = () => {
    const name = `esx${String(hosts.length + 1).padStart(2, "0")}-${short || "site"}.lhoist.local`;
    const { host, memory: m } = hostFromTemplate(template, name);
    setHosts([...hosts, host]);
    setMemory([...memory, m]);
    setOpen(hosts.length);
  };
  const removeHost = (i: number) => {
    setHosts(hosts.filter((_, j) => j !== i));
    setMemory(memory.filter((_, j) => j !== i));
    setOpen(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!hosts.length) {
      setError("Cadastre pelo menos um host.");
      return;
    }
    const payload: ClusterPayload = {
      site_id: Number(siteId),
      name: general.name.trim(),
      vcenter: general.vcenter.trim() || null,
      ha_enabled: general.ha,
      drs: general.drs,
      document: {
        hosts: hosts.map((h, i) => ({
          ...h,
          memory: { type: memory[i].type, speedMts: memory[i].speedMts, form: memory[i].form, maxModuleGb: memory[i].maxModuleGb, slots: slotsOf(memory[i], h.cpu.sockets) },
        })),
        datastores: datastores.map((d) => ({ ...d, name: d.name.trim() })),
        array: arrayOf(array),
        vcpus: general.vcpus ? Number(general.vcpus) : undefined,
      },
    };
    try {
      onSaved(cluster ? await api.clusters.update(cluster.id, payload) : await api.clusters.create(payload));
    } catch (e) {
      const message = (e as Error).message;
      setError(/conflict/i.test(message) ? "Este site já tem um cluster." : message);
    }
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <Modal
      wide
      title={cluster ? `Editar cluster · ${cluster.name}` : "Novo cluster"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="cluster-form" className="btn primary">
            Salvar
          </button>
        </>
      }
    >
      <form id="cluster-form" className="form-grid" onSubmit={submit}>
        <fieldset className="wide cluster-general">
          <legend>Cluster</legend>
          {!cluster && (
            <label>
              Site
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
                {!sites.length && <option value="">Todos os sites já têm cluster</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Nome
            <input value={general.name} required maxLength={120} onChange={(e) => setGeneral({ ...general, name: e.target.value })} placeholder={`CL-${short.toUpperCase() || "SITE"}-PROD`} />
          </label>
          <label>
            vCenter
            <input value={general.vcenter} maxLength={200} onChange={(e) => setGeneral({ ...general, vcenter: e.target.value })} placeholder={`vcsa01-${short || "site"}.lhoist.local`} />
          </label>
          <label>
            DRS
            <select value={general.drs} onChange={(e) => setGeneral({ ...general, drs: e.target.value })}>
              <option>Automático</option>
              <option>Manual</option>
            </select>
          </label>
          <label>
            vCPUs alocadas
            <input type="number" min={0} value={general.vcpus} onChange={(e) => setGeneral({ ...general, vcpus: e.target.value })} placeholder="Estimar" />
          </label>
          <label className="check">
            <input type="checkbox" checked={general.ha} onChange={(e) => setGeneral({ ...general, ha: e.target.checked })} />
            vSphere HA ativo
          </label>
        </fieldset>

        <fieldset className="wide">
          <legend>Hosts · {hosts.length}</legend>
          {hosts.map((h, i) => (
            <div key={i} className="host-edit">
              <div className="row-edit" style={{ gridTemplateColumns: "1.6fr 1.2fr 1fr 70px auto 28px" }}>
                <input value={h.name} onChange={(e) => setHost(i, { name: e.target.value })} required aria-label="Nome do host" />
                <input value={`${h.vendor} ${h.model}`.trim()} readOnly aria-label="Modelo" className="muted" />
                <input value={h.cpu.model} readOnly aria-label="Processador" className="muted" />
                <input type="number" min={0} value={h.vms} onChange={(e) => setHost(i, { vms: Number(e.target.value) })} aria-label="VMs" title="VMs" />
                <button type="button" className="btn ghost small" onClick={() => setOpen(open === i ? null : i)}>
                  {open === i ? "Fechar" : "Detalhes"}
                </button>
                <button type="button" className="icon-btn" aria-label="Remover host" onClick={() => removeHost(i)}>
                  ×
                </button>
              </div>
              {open === i && (
                <div className="host-detail">
                  <label>
                    Fabricante
                    <input value={h.vendor} onChange={(e) => setHost(i, { vendor: e.target.value })} />
                  </label>
                  <label>
                    Modelo
                    <input value={h.model} onChange={(e) => setHost(i, { model: e.target.value })} />
                  </label>
                  <label>
                    Série
                    <input value={h.serial} onChange={(e) => setHost(i, { serial: e.target.value })} />
                  </label>
                  <label>
                    Hypervisor
                    <input value={h.hypervisor} onChange={(e) => setHost(i, { hypervisor: e.target.value })} />
                  </label>
                  <label>
                    Estado
                    <select value={h.state} onChange={(e) => setHost(i, { state: e.target.value as HostDoc["state"] })}>
                      <option value="connected">Conectado</option>
                      <option value="maintenance">Manutenção</option>
                    </select>
                  </label>
                  <label>
                    CPU · fabricante
                    <select value={h.cpu.vendor} onChange={(e) => setCpu(i, { vendor: e.target.value as "Intel" | "AMD" })}>
                      <option>Intel</option>
                      <option>AMD</option>
                    </select>
                  </label>
                  <label>
                    CPU · modelo
                    <input value={h.cpu.model} onChange={(e) => setCpu(i, { model: e.target.value })} />
                  </label>
                  <label>
                    Sockets
                    <input type="number" min={1} max={8} value={h.cpu.sockets} onChange={(e) => setCpu(i, { sockets: Number(e.target.value) || 1 })} />
                  </label>
                  <label>
                    Cores por socket
                    <input type="number" min={1} value={h.cpu.coresPerSocket} onChange={(e) => setCpu(i, { coresPerSocket: Number(e.target.value) || 1 })} />
                  </label>
                  <label>
                    Threads por core
                    <select value={h.cpu.threadsPerCore} onChange={(e) => setCpu(i, { threadsPerCore: Number(e.target.value) })}>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </label>
                  <label>
                    Clock base (GHz)
                    <input type="number" min={0} step="any" value={h.cpu.baseGhz} onChange={(e) => setCpu(i, { baseGhz: num(e.target.value) })} />
                  </label>
                  <label>
                    Turbo (GHz)
                    <input type="number" min={0} step="any" value={h.cpu.turboGhz} onChange={(e) => setCpu(i, { turboGhz: num(e.target.value) })} />
                  </label>
                  <label>
                    Cache (MB)
                    <input type="number" min={0} step="any" value={h.cpu.cacheMb} onChange={(e) => setCpu(i, { cacheMb: num(e.target.value) })} />
                  </label>
                  <label>
                    Memória · tipo
                    <select value={memory[i].type} onChange={(e) => setMem(i, { type: e.target.value as MemoryInfo["type"] })}>
                      <option>DDR3</option>
                      <option>DDR4</option>
                      <option>DDR5</option>
                    </select>
                  </label>
                  <label>
                    Velocidade (MT/s)
                    <input type="number" min={0} value={memory[i].speedMts} onChange={(e) => setMem(i, { speedMts: Number(e.target.value) })} />
                  </label>
                  <label>
                    Formato
                    <select value={memory[i].form} onChange={(e) => setMem(i, { form: e.target.value as MemoryInfo["form"] })}>
                      <option>RDIMM</option>
                      <option>LRDIMM</option>
                    </select>
                  </label>
                  <label>
                    Slots por socket
                    <input type="number" min={1} max={32} value={memory[i].perSocket} onChange={(e) => setMem(i, { perSocket: Number(e.target.value) || 1 })} />
                  </label>
                  <label>
                    Módulos por socket
                    <input
                      type="number"
                      min={0}
                      max={memory[i].perSocket}
                      value={memory[i].filledPerSocket}
                      onChange={(e) => setMem(i, { filledPerSocket: Math.min(memory[i].perSocket, Number(e.target.value)) })}
                    />
                  </label>
                  <label>
                    Tamanho do módulo (GB)
                    <input type="number" min={1} value={memory[i].moduleGb} onChange={(e) => setMem(i, { moduleGb: Number(e.target.value) || 1 })} />
                  </label>
                  <label>
                    Módulo máximo (GB)
                    <input type="number" min={1} value={memory[i].maxModuleGb} onChange={(e) => setMem(i, { maxModuleGb: Number(e.target.value) || 1 })} />
                  </label>
                </div>
              )}
            </div>
          ))}
          <div className="row-edit" style={{ gridTemplateColumns: "auto 220px 1fr" }}>
            <button type="button" className="btn ghost small" onClick={addHost}>
              + Adicionar host
            </button>
            <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Modelo do host">
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.vendor} {t.model}
                </option>
              ))}
            </select>
            <span className="muted hint">O host novo vem com CPU e memória do modelo escolhido; ajuste em Detalhes.</span>
          </div>
        </fieldset>

        <fieldset className="wide">
          <legend>Datastores · {datastores.length}</legend>
          <div className="row-edit row-edit-head" style={{ gridTemplateColumns: "1.3fr 110px 1.8fr 100px 70px 28px" }}>
            <span>Nome</span>
            <span>Tipo</span>
            <span>Origem</span>
            <span>Capacidade (TB)</span>
            <span>Local</span>
            <span />
          </div>
          {datastores.map((d, i) => (
            <div key={i} className="row-edit" style={{ gridTemplateColumns: "1.3fr 110px 1.8fr 100px 70px 28px" }}>
              <input value={d.name} onChange={(e) => setStore(i, { name: e.target.value })} required aria-label="Nome" />
              <select value={d.type} onChange={(e) => setStore(i, { type: e.target.value as DatastoreType })} aria-label="Tipo">
                {DATASTORE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input value={d.backing} onChange={(e) => setStore(i, { backing: e.target.value })} aria-label="Origem" placeholder="PowerStore · LUN 01 · FC 32G" />
              <input
                type="number"
                min={0}
                step="any"
                value={d.capacityTb}
                onChange={(e) => setStore(i, { capacityTb: num(e.target.value) })}
                aria-label="Capacidade (TB)"
              />
              <input type="checkbox" checked={d.local} onChange={(e) => setStore(i, { local: e.target.checked })} aria-label="Local" />
              <button type="button" className="icon-btn" aria-label="Remover datastore" onClick={() => setDatastores(datastores.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setDatastores([...datastores, { name: `DS-${short.toUpperCase()}-${String(datastores.length + 1).padStart(2, "0")}`, type: "VMFS 6", backing: "", capacityTb: 4, local: false }])}
          >
            + Adicionar datastore
          </button>
        </fieldset>

        <fieldset className="wide cluster-array">
          <legend>Storage</legend>
          <label>
            Nome
            <input value={array.name} onChange={(e) => setArray({ ...array, name: e.target.value })} placeholder="SAN-01" />
          </label>
          <label>
            Modelo
            <input value={array.model} onChange={(e) => setArray({ ...array, model: e.target.value })} placeholder="Dell PowerStore 500T" />
          </label>
          <label>
            Proteção
            <input value={array.raid} onChange={(e) => setArray({ ...array, raid: e.target.value })} placeholder="RAID 6" />
          </label>
          <label>
            Baias
            <input type="number" min={0} max={120} value={array.bays} onChange={(e) => setArray({ ...array, bays: Number(e.target.value), filled: Math.min(array.filled, Number(e.target.value)) })} />
          </label>
          <label>
            Discos instalados
            <input type="number" min={0} max={array.bays} value={array.filled} onChange={(e) => setArray({ ...array, filled: Math.min(array.bays, Number(e.target.value)) })} />
          </label>
          <label>
            Tipo de disco
            <select value={array.kind} onChange={(e) => setArray({ ...array, kind: e.target.value as ArrayDraft["kind"] })}>
              {DISK_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Tamanho do disco (TB)
            <input type="number" min={0} step="any" value={array.sizeTb} onChange={(e) => setArray({ ...array, sizeTb: num(e.target.value) })} />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
