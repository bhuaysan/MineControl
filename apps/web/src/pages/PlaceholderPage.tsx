/** Platzhalter für Seiten, die erst in späteren Phasen kommen. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
        Diese Ansicht folgt in einer späteren Phase.
      </div>
    </div>
  );
}
