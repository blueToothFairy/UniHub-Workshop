## ADDED Requirements

### Requirement: Simulated payment action for paid registrations
The system MUST provide an authenticated action to simulate payment completion for paid workshop registrations.

#### Scenario: Student simulates payment successfully
- **WHEN** registration is `pending_payment` and student triggers `POST /registrations/:id/simulate-payment`
- **THEN** API MUST return HTTP `200` with body `{ "registration_id": string, "registration_status": "confirmed", "payment_status": "completed", "qr_available": true }`

#### Scenario: Simulation attempted on non-pending registration
- **WHEN** student triggers simulation for registration not in `pending_payment`
- **THEN** API MUST return HTTP `409` with body `{ "error": "INVALID_REGISTRATION_STATE_FOR_SIMULATION" }`

### Requirement: Simulation action idempotency
Simulated payment action MUST be idempotent per registration.

#### Scenario: Duplicate simulation request after confirmation
- **WHEN** student repeats `simulate-payment` on already confirmed registration
- **THEN** API MUST return HTTP `200` with unchanged confirmed/completed status and MUST NOT duplicate side effects

### Requirement: Payment status query for simulation mode
The system MUST expose payment status lookup compatible with simulation-based flows.

#### Scenario: Poll status before simulation
- **WHEN** client calls `GET /registrations/:id/payment-status` for paid pending registration
- **THEN** API MUST return HTTP `200` with body `{ "registration_id": string, "registration_status": "pending_payment", "payment_status": "pending_simulation", "next_action": "simulate_payment" }`

#### Scenario: Poll status after simulation
- **WHEN** client calls status endpoint after successful simulation
- **THEN** API MUST return HTTP `200` with body `{ "registration_id": string, "registration_status": "confirmed", "payment_status": "completed", "qr_available": true }`

### Requirement: Pending paid registration expiry

The system MUST expire paid pending registrations after a configured reservation window.

#### Scenario: Pending simulated payment expires
- WHEN a paid registration remains `pending_payment` past `reservation_expires_at`
- THEN registration MUST transition to `expired`
- AND payment MUST transition to `expired`
- AND `reserved_count` MUST be decremented exactly once

### Requirement: No external payment gateway integration in this capability
The simulation capability MUST NOT depend on external payment providers in this phase.

#### Scenario: Runtime isolation from external gateway
- **WHEN** paid registration and simulation actions execute
- **THEN** backend MUST complete flow without calling VNPay APIs and MUST NOT require callback endpoints for correctness
