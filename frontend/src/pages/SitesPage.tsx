import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { type Site, api } from "../api";
import { SiteForm } from "../components/SiteForm";
import { useResource } from "../components/useResource";

export function SitesPage() {
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (site: Site) => {
    if (!confirm(`Excluir o site ${site.code}?`)) return;
    try {
      await api.sites.remove(site.id);
      sites.reload();
    } catch (e) {
      setError(`${(e as Error).message}. Remova os links e VLANs do site antes.`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Cadastros</div>
          <h1>Sites</h1>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          + Novo site
        </button>
      </div>
      {(error || sites.error) && <div className="banner error">{error ?? sites.error}</div>}
      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Cidade</th>
              <th>UF</th>
              <th>País</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sites.items.map((site) => (
              <tr key={site.id}>
                <td className="mono">{site.code}</td>
                <td>{site.name}</td>
                <td>{site.city ?? "—"}</td>
                <td>{site.state ?? "—"}</td>
                <td>{site.country ?? "—"}</td>
                <td className="row-actions">
                  <Link className="btn ghost small" to={`/wan?site=${site.id}`}>
                    Ver WAN
                  </Link>
                  <button className="btn ghost small" onClick={() => setEditing(site)}>
                    Editar
                  </button>
                  <button className="btn danger small" onClick={() => remove(site)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {!sites.items.length && !sites.loading && (
              <tr>
                <td colSpan={6} className="muted empty">
                  Nenhum site cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {editing && (
        <SiteForm
          site={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            sites.reload();
          }}
        />
      )}
    </div>
  );
}
