import { Pencil, Plus } from "lucide-react";

interface Props {
  addLabel: string;
  onAdd?: () => void;
  editLabel: string;
  /* Without it the pencil is shown disabled, with editLabel explaining why. */
  onEdit?: () => void;
}

/* The add (+) and edit (pencil) buttons every leaf page carries next to its "simulated" badge. */
export function EditActions({ addLabel, onAdd, editLabel, onEdit }: Props) {
  return (
    <span className="edit-actions">
      <button type="button" className="icon-action" title={addLabel} aria-label={addLabel} onClick={onAdd} disabled={!onAdd}>
        <Plus size={15} strokeWidth={2} />
      </button>
      <button type="button" className="icon-action" title={editLabel} aria-label={editLabel} onClick={onEdit} disabled={!onEdit}>
        <Pencil size={14} strokeWidth={2} />
      </button>
    </span>
  );
}
