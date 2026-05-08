export type RegistrationStatus = "pending_payment" | "confirmed" | "cancelled" | "expired";
export type PaymentFlowStatus =
  | "pending_simulation"
  | "pending_provider"
  | "unknown"
  | "completed"
  | "failed"
  | "expired"
  | "requires_review";

export interface CreateRegistrationRequest {
  workshop_id: string;
}

export interface RegistrationCreatedFreeResponse {
  registration_id: string;
  registration_status: "confirmed";
  payment_required: false;
  qr_available: true;
}

export interface RegistrationCreatedPaidResponse {
  registration_id: string;
  registration_status: "pending_payment";
  payment_required: true;
  payment_id: string;
  payment_status: "pending_provider" | "unknown";
  payment_url: string | null;
  next_action: "redirect_to_payment";
}

export type CreateRegistrationResponse = RegistrationCreatedFreeResponse | RegistrationCreatedPaidResponse;

export interface PaymentStatusResponsePending {
  registration_id: string;
  registration_status: "pending_payment";
  payment_status: "pending_provider" | "unknown";
  payment_url: string | null;
  next_action: "redirect_to_payment" | "wait_for_confirmation";
}

export interface PaymentStatusResponseConfirmed {
  registration_id: string;
  registration_status: "confirmed";
  payment_status: "completed";
  qr_available: true;
}

export interface PaymentStatusResponseExpired {
  registration_id: string;
  registration_status: "expired";
  payment_status: "expired";
  next_action: "register_again";
}

export interface PaymentStatusResponseFailed {
  registration_id: string;
  registration_status: "cancelled";
  payment_status: "failed" | "requires_review";
  next_action: "register_again" | "contact_support";
}

export type PaymentStatusResponse =
  | PaymentStatusResponsePending
  | PaymentStatusResponseConfirmed
  | PaymentStatusResponseExpired
  | PaymentStatusResponseFailed;

export interface RegistrationQrResponse {
  registration_id: string;
  qr_token: string;
  qr_issued_at: string;
}

export interface CurrentRegistrationResponse {
  registration_id: string;
  workshop_id: string;
  registration_status: "pending_payment" | "confirmed";
  payment_status: "pending_provider" | "unknown" | "completed";
  payment_url: string | null;
  qr_available: boolean;
}

export interface MomoCallbackErrorResponse {
  error: {
    code:
      | "INVALID_SIGNATURE"
      | "PAYMENT_AMOUNT_MISMATCH"
      | "PAYMENT_NOT_FOUND"
      | "PAYMENT_CURRENCY_MISMATCH";
    message: string;
  };
}
