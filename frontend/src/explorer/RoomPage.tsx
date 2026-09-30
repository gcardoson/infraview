import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AreaChart, ArcGauge } from "./charts";
import { MEDIUM_SHORT, TOPOLOGIES } from "../topology/data";
import { STATUS_LABEL, useTopologyStatus } from "../topology/status";
import { type Health, KIND_LABEL, type Room, roomHealth, roomIssues, UNIT_LABEL, type UnitKind } from "./data";
import { RackElevation } from "./RackElevation";
import { METRICS, type MetricKey, type MetricSpec, metricSpec, type RoomTelemetry, useRoomTelemetry } from "./telemetry";
import { useExplorer } from "./useExplorer";

/* Room dashboard: environment gauges, 24h curves, presence/leak sensors, live events, cameras and racks. */

const HEALTH_LABEL: Record<Health, string> = { ok: "Normal", warn: "Atenção", crit: "Crítico" };
const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");
const SENSOR_ICON = { presence: "◉", door: "⊓", water: "≈", smoke: "☁" } as const;

const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 11);

function controller(room: Room) {
  const h = hash(room.id);
  const mac = Array.from({ length: 6 }, (_, i) => ((h >>> (i * 5)) & 0xff).toString(16).padStart(2, "0"));
  mac[0] = "00";
  return {
    ip: `10.${room.siteId % 250}.${(h % 200) + 10}.${((h >>> 8) % 240) + 10}`,
    mac: mac.join(":").toUpperCase(),
  };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* The 24h history is static between 15 min buckets; the last point follows the live value. */
function live(t: RoomTelemetry, key: MetricKey) {
  const h = t.history[key];
  return [...h.slice(0, -1), t.values[key]];
}

interface Group {
  title: string;
  gauges: { key: MetricKey; spec?: MetricSpec; max?: number }[];
  charts: { key: MetricKey; title: string; icon: string; spec?: MetricSpec }[];
}

function groups(room: Room): Group[] {
  const power: MetricSpec = {
    ...METRICS.power,
    max: room.powerCapacityKw,
    high: [room.powerCapacityKw * 0.8, room.powerCapacityKw * 0.9],
  };
  const temp = metricSpec(room, "tempIn");
  const inside: Group = {
    title: room.kind === "cpd" ? "Interno" : "Interior do rack",
    gauges: [{ key: "tempIn", spec: temp }, { key: "humIn" }],
    charts: [
      { key: "tempIn", title: "Temperatura · 24h", icon: "🌡", spec: temp },
      { key: "humIn", title: "Umidade · 24h", icon: "💧" },
    ],
  };
  const energy: Group = {
    title: room.kind === "cpd" ? "Energia dos racks" : "Energia do rack",
    gauges: [{ key: "voltage" }, { key: "power", spec: power }],
    charts: [
      { key: "voltage", title: "Tensão · 24h", icon: "⚡" },
      { key: "energy", title: "Consumo a cada 15 min · 24h", icon: "∑" },
    ],
  };
  // An access rack is a single cabinet: no cold aisle and no room air to measure.
  if (room.kind === "rack") return [inside, energy];
  return [
    {
      title: "Corredor frio",
      gauges: [{ key: "tempFront" }, { key: "humFront" }],
      charts: [
        { key: "tempFront", title: "Temperatura · 24h", icon: "🌡" },
        { key: "humFront", title: "Umidade · 24h", icon: "💧" },
      ],
    },
    inside,
    energy,
    {
      title: "Qualidade do ar",
      gauges: [{ key: "co2" }, { key: "pm25" }],
      charts: [
        { key: "co2", title: "CO₂ · 24h", icon: "◌" },
        { key: "pm25", title: "PM2.5 · 24h", icon: "⁂" },
      ],
    },
  ];
}

const DEVICE_KIND = { core: "Switch central", switch: "Switch", ap: "Access point", passive: "Passivo" } as const;

/* The room's switches and APs as documented in Topologia, with their (simulated) status and uplinks. */
function RoomNetwork({ room }: { room: Room }) {
  const topology = TOPOLOGIES.find((t) => t.code === room.topology)!;
  const health = useTopologyStatus(topology);
  const to = (node?: string) => `/topologia?site=${topology.code}${node ? `&node=${node}` : ""}`;
  return (
    <section className="panel room-network">
      <div className="room-section-title">
        Rede
        <Link to={to(room.devices[0]?.nodeId)} className="muted">
          Topologia {topology.code} · {topology.revision} ›
        </Link>
      </div>
      <ul className="room-devices">
        {room.devices.map((d) => {
          const h = health[d.nodeId];
          return (
            <li key={d.nodeId}>
              <span className={`topo-dot ${h?.status ?? "online"}`} title={h ? STATUS_LABEL[h.status] : undefined} />
              <Link to={to(d.nodeId)} className="mono">
                {d.hostname}
              </Link>
              <span className="muted">{DEVICE_KIND[d.kind]}</span>
              <span className="mono muted">{[d.ip, d.model].filter(Boolean).join(" · ")}</span>
              {d.nok && <span className="room-device-nok">{d.nok}</span>}
            </li>
          );
        })}
      </ul>
      {room.links.length > 0 && (
        <table className="room-links">
          <thead>
            <tr>
              <th>Enlace</th>
              <th>Meio</th>
              <th>Portas</th>
            </tr>
          </thead>
          <tbody>
            {room.links.map((l) => (
              <tr key={l.id} className={l.broken ? "broken" : undefined}>
                <td>
                  {l.peer}
                  {l.broken && <span className="topo-pill down">Interrompido</span>}
                </td>
                <td className="mono">
                  {MEDIUM_SHORT[l.medium]}
                  {l.fibers ? ` · ${l.fibers}f` : ""}
                </td>
                <td className="mono muted">{l.ports || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function RoomPage() {
  const { roomId = "" } = useParams();
  const { sites, explorer } = useExplorer();
  const site = explorer.find((s) => s.rooms.some((r) => r.id === roomId)) ?? null;
  const room = site?.rooms.find((r) => r.id === roomId) ?? null;
  const telemetry = useRoomTelemetry(room);
  const now = useClock();

  if (!room || !site || !telemetry) {
    return (
      <div className="room-page">
        <p className="muted">{sites.loading || !explorer.length ? "Carregando…" : "CPD ou rack não encontrado."}</p>
        <Link to="/explorer" className="btn">
          Voltar ao mapa
        </Link>
      </div>
    );
  }

  const health = roomHealth(room);
  const issues = roomIssues(room);
  const { ip, mac } = controller(room);
  const load = (room.powerKw / room.powerCapacityKw) * 100;
  const activeSensors = telemetry.sensors.filter((s) => s.active);

  return (
    <div className="room-page">
      <header className="room-head">
        <div>
          <nav className="room-crumbs muted" aria-label="Caminho">
            <Link to="/explorer">Explorer</Link>
            <span>/</span>
            <Link to={`/explorer?site=${site.site.id}`}>{site.site.code}</Link>
            <span>/</span>
            <span className="mono">{room.code}</span>
          </nav>
          <h1>
            {room.name}
            <span className={`room-status ${health}`}>
              <span className={`dot-lg ${health}`} /> {HEALTH_LABEL[health]}
            </span>
          </h1>
          <div className="muted">
            {KIND_LABEL[room.kind]} · {site.site.name} · {room.building}
          </div>
        </div>
        <div className="room-head-actions">
          <span
            className="badge sim"
            title="Switches, APs e enlaces vêm da Topologia; sensores, energia, câmeras e eventos são simulados"
          >
            Sensores simulados
          </span>
          <Link to={`/explorer?site=${site.site.id}`} className="btn">
            ‹ Voltar ao mapa
          </Link>
        </div>
      </header>

      <div className="room-layout">
        <div className="room-main">
          <div className="room-top">
            <section className="panel room-info">
              <div className="room-clock mono">{now.toLocaleTimeString("pt-BR")}</div>
              <div className="muted room-date">
                {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </div>
              <dl className="room-facts">
                <dt>Controlador</dt>
                <dd className="mono">{ip}</dd>
                <dt>MAC</dt>
                <dd className="mono">{mac}</dd>
                <dt>Acesso</dt>
                <dd>{room.access}</dd>
                <dt>Climatização</dt>
                <dd>{room.cooling}</dd>
                <dt>Nobreak</dt>
                <dd className="mono">{Math.round(room.upsMinutes)} min de autonomia</dd>
                <dt>Carga</dt>
                <dd className="mono">
                  {dec(room.powerKw, 2)} / {dec(room.powerCapacityKw)} kW ({Math.round(load)}%)
                </dd>
              </dl>
              {issues.length > 0 && (
                <ul className="room-issues">
                  {issues.map((i) => (
                    <li key={i.text} className={i.level}>
                      {i.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel room-sensors">
              <div className="room-section-title">
                Sensores
                <span className="muted">{activeSensors.length ? `${activeSensors.length} acionado(s)` : "nenhum acionado"}</span>
              </div>
              <div className="sensor-grid">
                {telemetry.sensors.map((s) => {
                  const alarm = s.active && (s.kind === "water" || s.kind === "smoke");
                  return (
                    <div key={s.id} className={`sensor-tile ${s.kind}${s.active ? " active" : ""}${alarm ? " alarm" : ""}`}>
                      <span className="sensor-icon" aria-hidden>
                        {SENSOR_ICON[s.kind]}
                      </span>
                      <span className="sensor-name">{s.label}</span>
                      <span className="sensor-state mono">
                        {s.active ? (s.kind === "door" ? "ABERTA" : s.kind === "presence" ? "MOVIMENTO" : "ALARME") : "normal"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel room-racks">
              <div className="room-section-title">
                {room.kind === "cpd" ? "Racks" : "Rack"}
                <span className="muted">{room.kind === "cpd" ? `${room.racks.length} × 42U` : `${room.racks[0].heightU}U`}</span>
              </div>
              <div className="room-rack-row">
                {room.racks.map((r) => (
                  <RackElevation key={r.id} rack={r} />
                ))}
              </div>
              <div className="ex-rack-legend muted">
                {(Object.keys(UNIT_LABEL) as UnitKind[])
                  .filter((k) => room.racks.some((r) => r.units.some((u) => u.kind === k)))
                  .map((k) => (
                    <span key={k}>
                      <i className={`ex-rack-unit ${k}`} />
                      {UNIT_LABEL[k]}
                    </span>
                  ))}
              </div>
            </section>
          </div>

          {room.topology && <RoomNetwork room={room} />}

          <div className="room-groups">
            {groups(room).map((g) => (
              <section key={g.title} className="room-group">
                <div className="panel room-gauges">
                  <div className="room-section-title">{g.title}</div>
                  <div className="room-gauge-pair">
                    {g.gauges.map((x) => {
                      const spec = x.spec ?? METRICS[x.key];
                      return <ArcGauge key={x.key} spec={spec} value={telemetry.values[x.key]} />;
                    })}
                  </div>
                </div>
                {g.charts.map((c) => (
                  <AreaChart
                    key={c.key}
                    title={c.title}
                    icon={c.icon}
                    spec={c.spec ?? METRICS[c.key]}
                    values={live(telemetry, c.key)}
                  />
                ))}
              </section>
            ))}
          </div>

          {room.cameras > 0 && (
            <section className="room-cameras">
              <div className="room-section-title">
                Câmeras CFTV
                <span className="muted">imagens simuladas</span>
              </div>
              <div className="camera-grid">
                {["Entrada", "Corredor dos racks"].slice(0, room.cameras).map((name, i) => (
                  <div key={name} className={`camera cam-${i}`}>
                    <div className="camera-scene" aria-hidden>
                      {Array.from({ length: room.racks.length }, (_, k) => (
                        <span key={k} className="camera-rack" />
                      ))}
                    </div>
                    <span className="camera-rec mono">
                      <span className="rec-dot" /> REC
                    </span>
                    <span className="camera-name mono">
                      CAM-0{i + 1} · {name}
                    </span>
                    <span className="camera-time mono">
                      {now.toLocaleDateString("pt-BR")} {now.toLocaleTimeString("pt-BR")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="panel room-events" aria-label="Eventos e notificações">
          <div className="room-section-title">
            Eventos e notificações
            <span className="live-tag">
              <span className="live-dot" /> ao vivo
            </span>
          </div>
          <ol className="event-log">
            {telemetry.events.length === 0 && <li className="muted empty">Aguardando eventos…</li>}
            {telemetry.events.slice(0, 40).map((e) => (
              <li key={e.id} className={e.level}>
                <span className="mono event-time">{e.time.toLocaleTimeString("pt-BR")}</span>
                <span className="event-source">{e.source}</span>
                <span className="event-msg">{e.message.replace(/(\d)\.(\d)/g, "$1,$2")}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
