## ADDED Requirements

### Requirement: Admin login with email and password
Admins SHALL authenticate using email and password credentials. The system SHALL validate credentials against the admin users table in PostgreSQL. Upon successful authentication, the system SHALL return a JWT token with `role: "admin"` claim that SHALL be used for all subsequent requests.

#### Scenario: Successful admin login
- **WHEN** admin enters correct email and password
- **THEN** system validates credentials, generates JWT token with admin role, and returns token to client

#### Scenario: Failed admin login
- **WHEN** admin enters incorrect password
- **THEN** system returns 401 Unauthorized without revealing whether email exists

#### Scenario: Admin token includes role claim
- **WHEN** JWT is generated for admin
- **THEN** token SHALL include claim `role: "admin"` that can be verified by backend middleware

### Requirement: Role-based access control middleware
The API SHALL enforce admin-only access on `/admin/*` routes using middleware that verifies JWT token contains `role: "admin"` claim. Non-admin users with valid tokens SHALL receive 403 Forbidden. Missing or invalid tokens SHALL receive 401 Unauthorized.

#### Scenario: Admin accesses admin route
- **WHEN** authenticated admin makes request to `/admin/workshops`
- **THEN** request is allowed and handler executes

#### Scenario: Student accesses admin route
- **WHEN** authenticated student (role: "student") makes request to `/admin/workshops`
- **THEN** system returns 403 Forbidden

#### Scenario: Unauthenticated user accesses admin route
- **WHEN** request to `/admin/workshops` has no or invalid JWT token
- **THEN** system returns 401 Unauthorized

### Requirement: Session persistence and logout
Admins SHALL remain authenticated using JWT tokens stored in secure HttpOnly cookies. The system SHALL provide a logout endpoint that clears the authentication cookie and invalidates the session server-side (optional for stateless JWT, but token SHALL be tracked in Redis blacklist).

#### Scenario: Admin logs out
- **WHEN** admin calls `/auth/logout`
- **THEN** authentication cookie is cleared and token is added to Redis blacklist for remaining TTL
