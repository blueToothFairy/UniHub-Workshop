type WorkshopDetailPageProps = {
  params: {
    id: string;
  };
};

export default function WorkshopDetailPage({
  params
}: WorkshopDetailPageProps): JSX.Element {
  return (
    <section>
      <h1>Workshop {params.id}</h1>
      <p>Workshop detail placeholder.</p>
    </section>
  );
}
