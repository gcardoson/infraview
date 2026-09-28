import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "number";
  options?: string[];
  required?: boolean;
}

interface Props<T> {
  resource: string;
  fields: Field[];
  columns: (keyof T & string)[];
}

export function ResourcePage<T extends { id: number }>({ resource, fields, columns }: Props<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api
      .list<T>(resource)
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [resource]);

  useEffect(load, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload: Record<string, string | number> = {};
    for (const field of fields) {
      const value = form[field.name]?.trim();
      if (value) payload[field.name] = field.type === "number" ? Number(value) : value;
    }
    try {
      await api.create<T>(resource, payload);
      setForm({});
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.remove(resource, id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const labelFor = (column: string) => fields.find((f) => f.name === column)?.label ?? column;

  return (
    <section>
      <form onSubmit={submit} className="create-form">
        {fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select
                value={form[field.name] ?? ""}
                required={field.required}
                onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
              >
                <option value="">—</option>
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type ?? "text"}
                value={form[field.name] ?? ""}
                required={field.required}
                onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
              />
            )}
          </label>
        ))}
        <button type="submit">Adicionar</button>
      </form>

      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{labelFor(column)}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {columns.map((column) => (
                <td key={column}>{String(item[column] ?? "")}</td>
              ))}
              <td>
                <button className="danger" onClick={() => remove(item.id)}>
                  Excluir
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="empty">
                Nenhum registro ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
