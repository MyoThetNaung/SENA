/** Page content block matching legacy `.tab-panel` + sticky `h1`. */
export function PageSection({ title, children, actions }) {
  return (
    <section className="tab-panel active">
      <h1>
        <span>{title}</span>
        {actions || null}
      </h1>
      {children}
    </section>
  );
}
