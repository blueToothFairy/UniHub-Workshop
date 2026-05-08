## MODIFIED Requirements

### Requirement: Workshop detail read API exposes summary state consistently
The system SHALL expose workshop summary fields and registration-facing availability fields in read APIs for student web clients.

#### Scenario: Read workshop with generated summary and seat info
- **GIVEN** workshop has `summary_status=ready`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`, `payment_required`, `confirmed_count`, `reserved_count`, and `available_seats`

#### Scenario: Read workshop during processing
- **GIVEN** workshop has `summary_status=processing`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `summary_status=processing` and clients MUST NOT receive stale previous summary

## ADDED Requirements

### Requirement: Workshop read contract supports simulation payment CTA
The workshop read response MUST provide enough fields for frontend to render correct registration CTA for free, paid-simulation, and full workshops.

#### Scenario: Paid workshop with seats available
- **WHEN** client reads published paid workshop where `available_seats > 0`
- **THEN** response MUST indicate `payment_required=true` and provide seat fields for frontend to show `Click to pay (Simulation)` after registration

#### Scenario: Full workshop
- **WHEN** client reads workshop where `available_seats = 0`
- **THEN** response MUST allow frontend to disable registration CTA regardless of payment mode