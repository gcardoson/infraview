import { NavLink, Outlet } from "react-router-dom";
import { Clock } from "./Clock";

const LAYERS = [
  { to: "/wan", label: "L4 · WAN", ready: true },
  { to: "/firewall", label: "Firewall", ready: false },
  { to: "/switches", label: "Switches", ready: false },
  { to: "/wifi", label: "Wi-Fi", ready: false },
  { to: "/servidores", label: "Servidores", ready: false },
  { to: "/telefonia", label: "Telefonia", ready: false },
];

export function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">INFRAVIEW</span>
          <span className="brand-sub">Inventário e monitoramento de infraestrutura</span>
        </div>
        <nav className="layers">
          {LAYERS.map((layer) =>
            layer.ready ? (
              <NavLink key={layer.to} to={layer.to} className="layer-tab">
                {layer.label}
              </NavLink>
            ) : (
              <span key={layer.to} className="layer-tab disabled" title="Em breve">
                {layer.label}
              </span>
            ),
          )}
          <span className="layers-sep" />
          <NavLink to="/sites" className="layer-tab">
            Sites
          </NavLink>
        </nav>
        <Clock />
      </header>
      <Outlet />
    </div>
  );
}
