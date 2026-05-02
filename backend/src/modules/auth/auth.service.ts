import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { QueryResultRow } from "pg";
import { AppError } from "../../shared/errors/AppError.js";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import type {
  AccessTokenPayload,
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  RefreshRequest,
  RefreshResponse,
  RefreshTokenPayload,
  UserRole
} from "./auth.types.js";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  student_id: string | null;
  password_hash: string;
  force_change_password: boolean;
}

interface RefreshTokenRow extends QueryResultRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    force_change_password: row.force_change_password
  };
}

export class AuthService {
  public constructor(private readonly database: IDatabase) {}

  public async register(input: RegisterRequest, ipAddress: string, userAgent: string): Promise<RegisterResponse> {
    const email: string = input.email.trim().toLowerCase();
    const fullName: string = input.full_name.trim();

    if (!email || !fullName) {
      throw new AppError(400, "INVALID_REGISTER_INPUT", "Email and full_name are required");
    }

    if (input.password.length < 8) {
      throw new AppError(400, "WEAK_PASSWORD", "Password must be at least 8 characters");
    }

    const existingResult = await this.database.query<UserRow>("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
    if (existingResult.rows[0]) {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", "Email is already registered");
    }

    const now: string = new Date().toISOString();
    const passwordHash: string = await bcrypt.hash(input.password, 12);
    const userId: string = randomUUID();

    const createdResult = await this.database.query<UserRow>(
      `INSERT INTO users (id, email, full_name, role, student_id, password_hash, force_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, 'student', NULL, $4, false, $5, $5)
       RETURNING *`,
      [userId, email, fullName, passwordHash, now]
    );

    const user: UserRow | undefined = createdResult.rows[0];
    if (!user) {
      throw new AppError(500, "REGISTER_FAILED", "Failed to create user");
    }

    const { accessToken, refreshToken, refreshTokenId } = this.issueTokens(user);
    await this.database.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id, user_agent, ip_address, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', NULL, NULL, $4, $5, NOW())`,
      [refreshTokenId, user.id, sha256(refreshToken), userAgent, ipAddress]
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: toAuthUser(user),
      force_change_password: false
    };
  }

  public async login(input: LoginRequest, ipAddress: string, userAgent: string): Promise<LoginResponse> {
    const userResult = await this.database.query<UserRow>("SELECT * FROM users WHERE email = $1 LIMIT 1", [input.email]);
    const user: UserRow | undefined = userResult.rows[0];
    if (!user) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    const matches: boolean = await bcrypt.compare(input.password, user.password_hash);
    if (!matches) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    const { accessToken, refreshToken, refreshTokenId } = this.issueTokens(user);

    await this.database.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id, user_agent, ip_address, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', NULL, NULL, $4, $5, NOW())`,
      [refreshTokenId, user.id, sha256(refreshToken), userAgent, ipAddress]
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: toAuthUser(user),
      force_change_password: user.force_change_password
    };
  }

  public async refresh(input: RefreshRequest, ipAddress: string, userAgent: string): Promise<RefreshResponse> {
    const refreshSecret: string = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "";
    let payload: RefreshTokenPayload;

    try {
      payload = jwt.verify(input.refresh_token, refreshSecret) as RefreshTokenPayload;
    } catch {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
    }

    if (payload.type !== "refresh") {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token type");
    }

    const currentResult = await this.database.query<RefreshTokenRow>(
      "SELECT * FROM refresh_tokens WHERE id = $1 AND token_hash = $2 LIMIT 1",
      [payload.token_id, sha256(input.refresh_token)]
    );
    const current = currentResult.rows[0];
    if (!current || current.revoked_at || current.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is revoked or expired");
    }

    const userResult = await this.database.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [current.user_id]);
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "User is no longer available");
    }

    const { accessToken, refreshToken, refreshTokenId } = this.issueTokens(user);

    await this.database.query("UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_token_id = $2 WHERE id = $1", [current.id, refreshTokenId]);
    await this.database.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id, user_agent, ip_address, created_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', NULL, NULL, $4, $5, NOW())`,
      [refreshTokenId, user.id, sha256(refreshToken), userAgent, ipAddress]
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken
    };
  }

  public async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.database.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(refreshToken)]);
  }

  public async changePassword(userId: string, input: ChangePasswordRequest): Promise<void> {
    if (input.new_password.length < 8) {
      throw new AppError(400, "WEAK_PASSWORD", "New password must be at least 8 characters");
    }

    const userResult = await this.database.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    const matches: boolean = await bcrypt.compare(input.old_password, user.password_hash);
    if (!matches) {
      throw new AppError(400, "INVALID_OLD_PASSWORD", "Old password is incorrect");
    }

    const nextHash: string = await bcrypt.hash(input.new_password, 12);
    await this.database.query("UPDATE users SET password_hash = $2, force_change_password = false, updated_at = NOW() WHERE id = $1", [userId, nextHash]);
  }

  public async me(userId: string): Promise<AuthUser> {
    const userResult = await this.database.query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    return toAuthUser(user);
  }

  private issueTokens(user: UserRow): { accessToken: string; refreshToken: string; refreshTokenId: string } {
    const jwtSecret: string = process.env.JWT_SECRET ?? "";
    const refreshSecret: string = process.env.JWT_REFRESH_SECRET || jwtSecret;
    const refreshTokenId: string = randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: "access"
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      token_id: refreshTokenId,
      type: "refresh"
    };

    const accessToken: string = jwt.sign(accessPayload, jwtSecret, { expiresIn: "15m" });
    const refreshToken: string = jwt.sign(refreshPayload, refreshSecret, { expiresIn: "7d" });

    return { accessToken, refreshToken, refreshTokenId };
  }
}

