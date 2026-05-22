import { NeuralBackgroundToggle } from '@/components/neural-background-toggle';

/** Page content block matching legacy `.tab-panel` + sticky `h1`. */
export function PageSection({ title, children, actions, neuralBgId, className = '' }) {
  const hasHeaderActions = neuralBgId || actions;
  return (
    <section className={`tab-panel active${className ? ` ${className}` : ''}`}>
      <h1>
        <span>{title}</span>
        {hasHeaderActions ? (
          <>
            {neuralBgId ? <NeuralBackgroundToggle id={neuralBgId} /> : null}
            {actions}
          </>
        ) : null}
      </h1>
      {children}
    </section>
  );
}
