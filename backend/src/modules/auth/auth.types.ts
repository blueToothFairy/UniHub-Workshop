export type UserRole = "student" | "organizer" | "checkin_staff";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  full_name: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  force_change_password: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
  force_change_password: boolean;
}

export type RegisterResponse = LoginResponse;

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  token_id: string;
  type: "refresh";
}
