type WorkshopCardProps = {
  title: string;
  summary: string;
};

export function WorkshopCard({
  title,
  summary
}: WorkshopCardProps): JSX.Element {
  return (
    <article>
      <h2>{title}</h2>
      <p>{summary}</p>
    </article>
  );
}
