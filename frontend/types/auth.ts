export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "organizer" | "checkin_staff";
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
