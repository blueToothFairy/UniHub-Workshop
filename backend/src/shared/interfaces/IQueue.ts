export interface IQueue {
  enqueueWorkshopChanged(workshopId: string, reason: string): Promise<void>;
}
