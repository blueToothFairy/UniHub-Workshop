## MODIFIED Requirements

### Requirement: Workshop detail read API exposes summary state consistently
The system SHALL expose workshop summary fields and registration-facing checkout context in read APIs for student web clients, including peak registration gate state needed for admission-first UX.

#### Scenario: Read workshop with generated summary and payment context
- **GIVEN** workshop has `summary_status=ready`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`, `payment_required`, and registration-facing seat availability fields used by checkout CTA decisions

#### Scenario: Read workshop during processing
- **GIVEN** workshop has `summary_status=processing`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `summary_status=processing` and clients MUST NOT receive stale previous summary

#### Scenario: Read workshop gate metadata during peak mode
- **GIVEN** workshop is configured for peak admission control
- **WHEN** client calls workshop detail or registration-gate read endpoint
- **THEN** response MUST expose registration gate status fields sufficient for UX state (`gate_status`, optional `retry_after`, and whether direct registration submission is currently allowed)

### Requirement: Student checkout CTA aligns with redirect payment flow
The workshop read + student UX contract MUST support MoMo redirect checkout instead of simulation action and MUST support waiting-room admission before registration submit during peak windows.

#### Scenario: Paid workshop with available seats and open gate
- **GIVEN** student is online and gate allows registration submission
- **WHEN** client reads a paid published workshop with available seats
- **THEN** frontend MUST render registration CTA that leads to provider checkout redirect flow after registration API response

#### Scenario: Paid workshop with available seats but waiting gate
- **GIVEN** student is online, workshop has available seats, and peak gate state is waiting
- **WHEN** client reads workshop and gate context
- **THEN** frontend MUST render waiting CTA/state and MUST NOT trigger direct registration submit until admission is granted

#### Scenario: Full workshop regardless of payment mode
- **GIVEN** workshop has no available seats
- **WHEN** client reads workshop detail
- **THEN** frontend MUST disable paid/free registration CTA consistently and MUST NOT expose payment redirect action
