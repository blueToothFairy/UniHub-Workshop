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
              <th>Speaker</th>
              <th>Room</th>
              <th>Start Time</th>
              <th>End Time</th>
              <th>Price (VND)</th>
              <th>Payment Required</th>
              <th>Capacity</th>
              <th>Reserved</th>
              <th>Confirmed</th>
              <th>Available Seats</th>
              <th>Status</th>
              <th>Summary Status</th>
            </tr>
          </thead>
          <tbody>
            {workshops.map((workshop) => (
              <tr key={workshop.id}>
                <td>{workshop.title}</td>
                <td>{workshop.speakerName}</td>
                <td>{workshop.room}</td>
                <td>{new Date(workshop.startsAt).toLocaleString("en-GB")}</td>
                <td>{new Date(workshop.endsAt).toLocaleString("en-GB")}</td>
                <td>{workshop.priceVnd.toLocaleString("en-US")}</td>
                <td>{workshop.paymentRequired ? "Yes" : "No"}</td>
                <td>{workshop.capacity}</td>
                <td>{workshop.reservedCount}</td>
                <td>{workshop.confirmedCount}</td>
                <td>{workshop.availableSeats}</td>
                <td>{workshop.status}</td>
                <td>{workshop.summaryStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
