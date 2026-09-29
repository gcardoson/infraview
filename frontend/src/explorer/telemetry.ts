import { useEffect, useRef, useState } from "react";
import type { Room } from "./data";

/* Fictitious room sensors: gauges, 24h history, presence/leak sensors and an event log. */

export type Level = "ok" | "warn" | "crit";

export interface MetricSpec {
  key: MetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  digits: number;
  /* Thresholds as [warnFrom, critFrom]; `low` adds the same idea below the range (voltage, humidity). */
  high?: [number, number];
  low?: [number, number];
  color: string;
}

export type MetricKey =
  | "tempFront"
  | "humFront"
  | "tempIn"
  | "humIn"
  | "voltage"
  | "power"
  | "co2"
  | "pm25"
  | "energy";

export const METRICS: Record<MetricKey, MetricSpec> = {
  tempFront: { key: "tempFront", label: "Temperatura", unit: "°C", min: 10, max: 40, digits: 1, high: [27, 30], color: "#2ee6a0" },
  humFront: { key: "humFront", label: "Umidade", unit: "%", min: 0, max: 100, digits: 1, high: [60, 70], low: [30, 20], color: "#5aa9ff" },
  tempIn: { key: "tempIn", label: "Temperatura", unit: "°C", min: 10, max: 40, digits: 1, high: [27, 30], color: "#2ee6a0" },
  humIn: { key: "humIn", label: "Umidade", unit: "%", min: 0, max: 100, digits: 1, high: [60, 70], low: [30, 20], color: "#5aa9ff" },
  voltage: { key: "voltage", label: "Tensão", unit: "V", min: 180, max: 250, digits: 1, high: [232, 240], low: [208, 200], color: "#b58cff" },
  power: { key: "power", label: "Potência", unit: "kW", min: 0, max: 10, digits: 2, color: "#f2b84b" },
  co2: { key: "co2", label: "CO₂", unit: "ppm", min: 0, max: 2000, digits: 0, high: [1000, 1500], color: "#2ee6a0" },
  pm25: { key: "pm25", label: "PM2.5", unit: "µg/m³", min: 0, max: 75, digits: 1, high: [25, 50], color: "#ff8a5c" },
  energy: { key: "energy", label: "Consumo", unit: "kWh", min: 0, max: 1, digits: 2, color: "#f2b84b" },
};

export function levelOf(spec: MetricSpec, value: number): Level {
  if (spec.high && value >= spec.high[1]) return "crit";
  if (spec.low && value <= spec.low[1]) return "crit";
  if (spec.high && value >= spec.high[0]) return "warn";
  if (spec.low && value <= spec.low[0]) return "warn";
  return "ok";
}

export interface Sensor {
  id: string;
  label: string;
  kind: "presence" | "door" | "water" | "smoke";
  active: boolean;
}

export interface RoomEvent {
  id: number;
  time: Date;
  level: Level;
  source: string;
  message: string;
}

export interface RoomTelemetry {
  values: Record<MetricKey, number>;
  history: Record<MetricKey, number[]>;
  sensors: Sensor[];
  events: RoomEvent[];
}

export const HISTORY_POINTS = 96; // 24h at 15 min

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/* A daily curve (warmer in the afternoon) plus noise, ending at `end`. */
function series(rand: () => number, end: number, amplitude: number, noise: number, spike = 0): number[] {
  const out: number[] = [];
  const phase = rand() * Math.PI;
  for (let i = 0; i < HISTORY_POINTS; i++) {
    const t = (i / HISTORY_POINTS) * Math.PI * 2;
    const spikeHere = spike && i > 60 && i < 66 ? spike * Math.sin(((i - 60) / 6) * Math.PI) : 0;
    out.push(end + Math.sin(t + phase) * amplitude + (rand() - 0.5) * noise + spikeHere);
  }
  out[out.length - 1] = end;
  return out;
}

function initial(room: Room): RoomTelemetry {
  const rand = rng(hash(room.id));
  const powerKw = room.powerKw;
  const values: Record<MetricKey, number> = {
    tempFront: room.temperatureC - 2 - rand(),
    humFront: room.humidity - 3 + rand() * 4,
    tempIn: room.temperatureC,
    humIn: room.humidity,
    voltage: 219 + rand() * 7,
    power: powerKw,
    co2: 420 + rand() * 180,
    pm25: rand() * 6,
    energy: powerKw / 4, // kWh in the current 15 min bucket
  };
  return {
    values,
    history: {
      tempFront: series(rand, values.tempFront, 0.9, 0.4),
      humFront: series(rand, values.humFront, 5, 2.5),
      tempIn: series(rand, values.tempIn, 1.1, 0.5),
      humIn: series(rand, values.humIn, 6, 3),
      voltage: series(rand, values.voltage, 1.5, 1.2, 4),
      power: series(rand, values.power, values.power * 0.08, values.power * 0.05),
      co2: series(rand, values.co2, 40, 60, 220),
      pm25: series(rand, values.pm25, 1.5, 1.2, 9).map((v) => Math.max(0, v)),
      energy: series(rand, values.energy, values.energy * 0.08, values.energy * 0.06),
    },
    sensors: [
      { id: "porta", label: "Porta", kind: "door", active: false },
      { id: "interno", label: "Interno", kind: "presence", active: false },
      { id: "corredor", label: "Corredor", kind: "presence", active: false },
      { id: "fundos", label: "Fundos", kind: "presence", active: false },
      { id: "agua", label: "Água", kind: "water", active: false },
      { id: "fumaca", label: "Fumaça", kind: "smoke", active: false },
    ],
    events: [],
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function useRoomTelemetry(room: Room | null, tickMs = 2000): RoomTelemetry | null {
  const [state, setState] = useState<RoomTelemetry | null>(() => (room ? initial(room) : null));
  const current = useRef(state);
  const seq = useRef(0);
  const roomId = room?.id;
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const r = roomRef.current;
    const next = r ? initial(r) : null;
    current.current = next;
    setState(next);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => {
      const prev = current.current;
      const r = roomRef.current;
      if (!prev || !r) return;
      const events: RoomEvent[] = [];
      const log = (level: Level, source: string, message: string) =>
        events.push({ id: ++seq.current, time: new Date(), level, source, message });

      const v = { ...prev.values };
      v.tempIn = r.temperatureC;
      v.humIn = r.humidity;
      v.power = r.powerKw;
      v.tempFront = clamp(v.tempFront + (r.temperatureC - 2 - v.tempFront) * 0.1 + (Math.random() - 0.5) * 0.2, 12, 38);
      v.humFront = clamp(v.humFront + (Math.random() - 0.5) * 0.8, 25, 80);
      v.voltage = clamp(v.voltage + (222 - v.voltage) * 0.1 + (Math.random() - 0.5) * 1.6, 195, 245);
      v.co2 = clamp(v.co2 + (470 - v.co2) * 0.05 + (Math.random() - 0.5) * 18, 380, 1900);
      v.pm25 = clamp(v.pm25 + (3 - v.pm25) * 0.08 + (Math.random() - 0.5) * 0.8, 0, 70);
      v.energy = v.power / 4;

      const sensors = prev.sensors.map((s) => ({ ...s }));
      for (const s of sensors) {
        if (s.kind === "presence" || s.kind === "door") {
          const flip = s.active ? Math.random() < 0.3 : Math.random() < 0.04;
          if (flip) {
            s.active = !s.active;
            if (s.kind === "door") log(s.active ? "warn" : "ok", "Porta", s.active ? "Porta aberta" : "Porta fechada");
            else log("ok", `Presença · ${s.label}`, s.active ? "movimento detectado" : "sem movimento");
            if (s.active) v.co2 += 40;
          }
        } else if (s.kind === "water") {
          if (!s.active && Math.random() < 0.004) {
            s.active = true;
            log("crit", "Vazamento", "Sensor de água acionado sob o piso elevado");
          } else if (s.active && Math.random() < 0.2) {
            s.active = false;
            log("ok", "Vazamento", "Sensor de água normalizado");
          }
        }
      }

      for (const key of ["tempIn", "humIn", "voltage", "co2", "pm25"] as MetricKey[]) {
        const before = levelOf(METRICS[key], prev.values[key]);
        const after = levelOf(METRICS[key], v[key]);
        if (before !== after) {
          const spec = METRICS[key];
          const text = `${spec.label} ${after === "ok" ? "normalizada" : after === "warn" ? "em atenção" : "crítica"}: ${v[key].toFixed(spec.digits)} ${spec.unit}`;
          log(after, "Ambiente", text);
        }
      }

      const next: RoomTelemetry = {
        values: v,
        history: prev.history, // 24h curves move every 15 min, not every tick
        sensors,
        events: events.length ? [...events.reverse(), ...prev.events].slice(0, 100) : prev.events,
      };
      current.current = next;
      setState(next);
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [roomId, tickMs]);

  return state;
}
