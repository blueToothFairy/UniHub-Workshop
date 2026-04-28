type DashboardStatCardProps = {
  label: string;
  value: string | number;
};

export function DashboardStatCard({
  label,
  value
}: DashboardStatCardProps): JSX.Element {
  return (
    <article>
      <strong>{label}</strong>
      <div>{value}</div>
    </article>
  );
}
