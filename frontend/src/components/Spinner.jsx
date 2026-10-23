/** Centered loading spinner used for route/data loading states. */
export default function Spinner({ label = 'Loading…' }) {
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center gap-2 py-5"
      role="status"
    >
      <span className="spinner-border text-primary" aria-hidden="true" />
      <span className="text-muted">{label}</span>
    </div>
  );
}
