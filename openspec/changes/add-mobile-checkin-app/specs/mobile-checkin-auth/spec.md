## ADDED Requirements

### Requirement: Check-in staff can sign in and enter the mobile check-in workspace
The mobile app SHALL authenticate against the existing backend auth contract and SHALL only admit users whose resolved role is `checkin_staff`.

#### Scenario: Successful staff login
- **GIVEN** the device is online
- **AND** the user submits valid email and password credentials
- **AND** `POST /auth/login` returns HTTP `200` with `{ "access_token": string, "refresh_token": string, "user": { "role": "checkin_staff" }, "force_change_password": boolean }`
- **WHEN** the app completes sign-in
- **THEN** it MUST persist the returned tokens locally
- **AND** it MUST transition the user into the mobile check-in workspace without requiring a second login call

#### Scenario: Non-staff login is rejected by the mobile app
- **GIVEN** the device is online
- **AND** the user submits valid credentials for an account whose resolved role is not `checkin_staff`
- **WHEN** the app receives a successful auth response
- **THEN** it MUST deny access to the check-in workspace
- **AND** it MUST clear any tokens from that response instead of keeping an active session
- **AND** it MUST show a staff-only access message without exposing raw token values

### Requirement: The mobile app restores and validates an existing staff session
The mobile app SHALL restore a previously saved session on launch, SHALL validate the session against the backend before enabling check-in actions, and SHALL refresh expired access tokens using the refresh contract instead of forcing immediate logout.

#### Scenario: Existing session restores successfully
- **GIVEN** the device has stored access and refresh tokens from a previous `checkin_staff` login
- **WHEN** the app launches while the access token is still valid
- **THEN** it MUST verify the session before enabling scan or sync actions
- **AND** it MUST return the staff user directly to the check-in workspace if the resolved user is still `checkin_staff`

#### Scenario: Expired access token is refreshed
- **GIVEN** the device has a stored refresh token
- **AND** the access token is expired or rejected for authorization
- **WHEN** the app calls `POST /auth/refresh`
- **THEN** the app MUST accept HTTP `200` with `{ "access_token": string, "refresh_token": string }`
- **AND** it MUST replace the locally stored tokens with the refreshed pair
- **AND** it MUST retry the blocked session restoration or protected request once before showing a login prompt

#### Scenario: Session restoration fails and user must sign in again
- **GIVEN** the device has a stored session that can no longer be refreshed
- **WHEN** `POST /auth/refresh` returns HTTP `401` with `{ "error": { "code": string, "message": string } }`
- **THEN** the app MUST clear the invalid stored session
- **AND** it MUST return the user to the login state
- **AND** it MUST preserve any pending offline check-in queue already stored in SQLite
