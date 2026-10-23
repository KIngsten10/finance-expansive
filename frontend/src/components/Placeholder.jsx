/** Simple placeholder shown for module pages that arrive in later phases. */
export default function Placeholder({ title }) {
  return (
    <div>
      <h1 className="h4 mb-3">{title}</h1>
      <div className="alert alert-secondary" role="alert">
        This module is coming in a later phase.
      </div>
    </div>
  );
}
