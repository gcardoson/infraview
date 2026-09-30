import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SitesPage } from "./pages/SitesPage";
import { ServersPage } from "./servers/ServersPage";
import { ExplorerPage } from "./explorer/ExplorerPage";
import { RoomPage } from "./explorer/RoomPage";
import { LanPage } from "./lan/LanPage";
import { TopologyPage } from "./topology/TopologyPage";
import { WanPage } from "./wan/WanPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/explorer" replace />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/explorer/sala/:roomId" element={<RoomPage />} />
          <Route path="/wan" element={<WanPage />} />
          <Route path="/lan" element={<LanPage />} />
          <Route path="/topologia" element={<TopologyPage />} />
          <Route path="/servidores" element={<ServersPage />} />
          <Route path="/sites" element={<SitesPage />} />
          <Route path="*" element={<Navigate to="/explorer" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
