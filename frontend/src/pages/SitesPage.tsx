import { type FormEvent, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { type Site, type SitePayload, api } from "../api";
import { Modal } from "../components/Modal";
import { useResource } from "../components/useResource";

const FIELDS: { key: keyof SitePayload; label: string; required?: boolean; numeric?: boolean; hint?: string }[] = [
  { key: "code", label: "Código", required: true },
  { key: "name", label: "Nome", required: true },
  { key: "city", label: "Cidade" },
  { key: "state", label: "UF" },
  { key: "country", label: "País" },
  { key: "latitude", label: "Latitude", numeric: true, hint: "-20,2863" },
  { key: "longitude", label: "Longitude", numeric: true, hint: "-45,5402" },
  { key: "notes", label: "Observações" },
];

function SiteForm({ site, onClose, onSaved }: { site: Site | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => {
        const value = String(site?.[f.key] ?? "");
        return [f.key, f.numeric ? value.replace(".", ",") : value];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(
      FIELDS.map((f) => {
        const value = draft[f.key].trim();
        if (value === "") return [f.key, null];
        return [f.key, f.numeric ? Number(value.replace(",", ".")) : value];
      }),
    ) as unknown as SitePayload;
    try {
      if (site) await api.sites.update(site.id, payload);
      else await api.sites.create(payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={site ? `Editar site · ${site.code}` : "Novo site"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="site-form" className="btn primary">
            Salvar
          </button>
        </>
      }
    >
      <form id="site-form" className="form-grid" onSubmit={submit}>
        <fieldset className="wide">
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                value={draft[f.key]}
                required={f.required}
                placeholder={f.hint}
                inputMode={f.numeric ? "decimal" : undefined}
                pattern={f.numeric ? "-?[0-9]+([.,][0-9]+)?" : undefined}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

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
      setError(`${(e as Error).message}. Remova os links e equipamentos do site antes.`);
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
