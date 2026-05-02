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
      <div className="card" style={{ overflowX: "auto" }}>
        <table cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Title</th>
              <th align="left">Room</th>
              <th align="left">Time</th>
              <th align="left">Status</th>
              <th align="left">Seats</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

