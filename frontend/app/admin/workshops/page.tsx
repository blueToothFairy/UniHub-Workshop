import type { ReactElement } from "react";
import { adminApi } from "@/lib/api";
import { getAccessTokenFromCookie } from "@/lib/auth";
import WorkshopManager from "@/components/admin/workshop-manager";

export default async function AdminWorkshopsPage(): Promise<ReactElement> {
  const token: string = await getAccessTokenFromCookie();
  if (!token) {
    return <p>Missing access token cookie.</p>;
  }

  const workshops = await adminApi.getWorkshops(token);

  return (
    <section className="grid">
      <h1>Workshops</h1>
      <WorkshopManager token={token} workshops={workshops} />
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Room</th>
              <th>Time</th>
              <th>Status</th>
              <th>Seats</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {workshops.map((workshop) => (
              <tr key={workshop.id}>
                <td>{workshop.title}</td>
                <td>{workshop.room}</td>
                <td>{new Date(workshop.startsAt).toLocaleString("vi-VN")}</td>
                <td>{workshop.status}</td>
                <td>{workshop.confirmedRegistrations}/{workshop.capacity}</td>
                <td>{workshop.summaryStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
