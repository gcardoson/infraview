import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COLOR_LABEL, type NetworkSwitch, portColor, portProblem, speedLabel } from "./data";

/* Styled tooltip for switch ports. It follows the cursor, fades in and out, and flips near the viewport edges.
   Hover state comes from event delegation on the grid: every port button carries data-switch and data-port. */

interface Target {
  switchId: string;
  port: number;
}

const OFFSET = 16;
const HIDE_DELAY_MS = 90;

export function usePortTooltip() {
  const [target, setTarget] = useState<Target | null>(null);
  const [visible, setVisible] = useState(false);
  const pointer = useRef({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(undefined);
  const frame = useRef<number>(undefined);

  const place = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { x, y } = pointer.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + OFFSET + w > window.innerWidth - 8 ? x - OFFSET - w : x + OFFSET;
    const top = y + OFFSET + h > window.innerHeight - 8 ? y - OFFSET - h : y + OFFSET;
    el.style.transform = `translate3d(${Math.max(8, left)}px, ${Math.max(8, top)}px, 0)`;
  }, []);

  const schedulePlace = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      place();
    });
  }, [place]);

  const show = useCallback((next: Target) => {
    window.clearTimeout(hideTimer.current);
    setTarget((current) => (current?.switchId === next.switchId && current.port === next.port ? current : next));
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    // A short delay keeps the tooltip steady while the cursor crosses the gap between two squares.
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  }, []);

  const readTarget = (el: EventTarget | null): Target | null => {
    const button = (el as HTMLElement | null)?.closest?.<HTMLElement>("[data-port]");
    if (!button?.dataset.switch) return null;
    return { switchId: button.dataset.switch, port: Number(button.dataset.port) };
  };

  const handlers = {
    onMouseMove: (e: React.MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const next = readTarget(e.target);
      if (next) show(next);
      else hide();
      schedulePlace();
    },
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent) => {
      const next = readTarget(e.target);
      if (!next) return;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      pointer.current = { x: rect.right, y: rect.bottom };
      show(next);
      schedulePlace();
    },
    onBlur: hide,
  };

  // Content changes size (different descriptions), so re-place once it has rendered.
  useLayoutEffect(place, [place, target]);
  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { target, visible, box, handlers };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="tt-label">{label}</span>
      <span className="tt-value">{children}</span>
    </>
  );
}

export function PortTooltip({
  switches,
  target,
  visible,
  box,
}: {
  switches: NetworkSwitch[];
  target: Target | null;
  visible: boolean;
  box: React.RefObject<HTMLDivElement | null>;
}) {
  const sw = target ? switches.find((s) => s.id === target.switchId) : undefined;
  const port = sw?.ports.find((p) => p.index === target?.port);
  const color = port ? portColor(port) : "off";
  const problem = port ? portProblem(port) : null;

  return (
    <div ref={box} className={`port-tooltip ${color}${visible && port ? " visible" : ""}`} role="tooltip" aria-hidden={!visible}>
      {sw && port && (
        <div className="tt-card">
          <div className="tt-head">
            <span className="tt-title mono">
              {sw.hostname} <span className="tt-port">· {port.name}</span>
            </span>
            <span className={`tt-state ${color}`}>{COLOR_LABEL[color]}</span>
          </div>
          <div className="tt-grid">
            <Row label="Descrição">
              <span className="mono">{port.description ?? "—"}</span>
            </Row>
            <Row label="Velocidade">{speedLabel(port.speedMbps)}</Row>
            {port.link === "up" && (
              <Row label="Uso">
                <span className="tt-bar">
                  <span style={{ width: `${port.utilization}%` }} />
                </span>
                <span className="mono">{port.utilization}%</span>
              </Row>
            )}
            <Row label="VLAN">
              <span className="mono">{port.vlan ?? (port.uplink ? "Trunk" : "—")}</span>
            </Row>
            {port.poeWatts !== null && <Row label="PoE">{port.poeWatts.toFixed(1)} W</Row>}
            {port.errors > 0 && (
              <Row label="Erros CRC">
                <span className="mono">{port.errors}</span>
              </Row>
            )}
          </div>
          {problem && port.adminUp && <div className={`tt-problem ${color}`}>{problem}</div>}
          <div className="tt-hint">Clique para fixar nos detalhes</div>
        </div>
      )}
    </div>
  );
}
