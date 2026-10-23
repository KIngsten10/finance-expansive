/** Reusable empty-state block with an optional call-to-action. */
export default function EmptyState({ title, message, action }) {
  return (
    <div className="text-center text-muted py-5">
      <div className="h5 mb-2">{title}</div>
      {message && <p className="mb-3">{message}</p>}
      {action}
    </div>
  );
}
