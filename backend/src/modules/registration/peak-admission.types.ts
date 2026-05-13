export type RegistrationGateStatus = "disabled" | "open" | "waiting" | "admitted" | "full";

export interface RegistrationGateResponseDisabled {
  status: "disabled";
}

export interface RegistrationGateResponseOpen {
  status: "open";
}

export interface RegistrationGateResponseWaiting {
  status: "waiting";
  queue_position: number;
  retry_after: number;
}

export interface RegistrationGateResponseAdmitted {
  status: "admitted";
  retry_after: number;
}

export interface RegistrationGateResponseFull {
  status: "full";
}

export type RegistrationGateResponse =
  | RegistrationGateResponseDisabled
  | RegistrationGateResponseOpen
  | RegistrationGateResponseWaiting
  | RegistrationGateResponseAdmitted
  | RegistrationGateResponseFull;

export interface RegistrationAdmissionResponseDisabled {
  status: "disabled";
}

export interface RegistrationAdmissionResponseOpen {
  status: "open";
}

export interface RegistrationAdmissionResponseWaiting {
  status: "waiting";
  queue_position: number;
  retry_after: number;
}

export interface RegistrationAdmissionResponseAdmitted {
  status: "admitted";
  admission_token: string;
  expires_in: number;
}

export interface RegistrationAdmissionResponseFull {
  status: "full";
}

export type RegistrationAdmissionResponse =
  | RegistrationAdmissionResponseDisabled
  | RegistrationAdmissionResponseOpen
  | RegistrationAdmissionResponseWaiting
  | RegistrationAdmissionResponseAdmitted
  | RegistrationAdmissionResponseFull;

export interface PeakRegistrationAttemptInput {
  workshopId: string;
  userId: string;
  admissionToken: string | null;
}

export interface IPeakAdmissionService {
  getRegistrationGate(input: { workshopId: string; userId: string }): Promise<RegistrationGateResponse>;
  requestAdmission(input: { workshopId: string; userId: string }): Promise<RegistrationAdmissionResponse>;
  validateRegistrationAttempt(input: PeakRegistrationAttemptInput): Promise<void>;
}
