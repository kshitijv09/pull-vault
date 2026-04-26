import Decimal from "decimal.js";
import { setCachedWalletBalance, userWalletBalanceKey } from "../../infra/redis/auctionWalletStore";
import { AppError } from "../../shared/errors/AppError";
import { UserRepository } from "./user.repository";
import type {
  CreateUserInput,
  PublicUserProfile,
  UserCardsFilter,
  UserCardsListingScope,
  UserOwnedCardFacets,
  UserProfile
} from "./user.types";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

interface DepositFundsInput {
  userId: string;
  amount: string;
}

export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async signup(input: CreateUserInput & { password?: string }): Promise<UserProfile> {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const phone = this.normalizeOptionalField(input.phone);
    const city = this.normalizeOptionalField(input.city);
    const country = this.normalizeOptionalField(input.country);
    
    if (!input.password || input.password.length < 6) {
      throw new AppError("Password is required and must be at least 6 characters.", 400);
    }

    if (!email || !email.includes("@")) {
      throw new AppError("A valid email is required.", 400);
    }

    if (!fullName) {
      throw new AppError("Full name is required.", 400);
    }

    const initialBalance = "1000.00";
    const passwordHash = await bcrypt.hash(input.password, 10);

    return this.repository.create({
      email,
      passwordHash,
      fullName,
      phone,
      city,
      country,
      initialBalance
    });
  }

  async login(emailInput: string, passwordInput: string): Promise<{ token: string; user: UserProfile }> {
    const email = emailInput.trim().toLowerCase();
    
    if (!email || !passwordInput) {
      throw new AppError("Email and password are required.", 400);
    }
    
    const record = await this.repository.getByEmailWithPassword(email);
    if (!record) {
      throw new AppError("Invalid email or password.", 401);
    }
    
    const isMatch = await bcrypt.compare(passwordInput, record.passwordHash);
    if (!isMatch) {
      throw new AppError("Invalid email or password.", 401);
    }
    
    const token = jwt.sign(
      { id: record.profile.id, email: record.profile.email },
      env.jwtSecret,
      { expiresIn: "2d" }
    );
    
    return { token, user: record.profile };
  }

  async getUser(userId: string): Promise<UserProfile> {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }

    return this.repository.getById(userId);
  }

  async getPublicProfilesByIds(userIds: string[]): Promise<PublicUserProfile[]> {
    const normalized = Array.from(
      new Set(
        userIds
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );
    if (normalized.length === 0) return [];
    return this.repository.getPublicProfilesByIds(normalized);
  }

  async depositFunds(input: DepositFundsInput): Promise<UserProfile> {
    this.assertMoneyAmount(input.amount);
    const user = await this.repository.depositFunds(input);
    await setCachedWalletBalance(userWalletBalanceKey(user.id), user.balance);
    return user;
  }

  async getCards(userId: string, filter?: UserCardsFilter): Promise<any[]> {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }
    const collectionListing = this.normalizeListingScope(filter?.collectionListing);
    return this.repository.getCards(userId, { ...filter, collectionListing });
  }

  private normalizeListingScope(raw?: string): UserCardsListingScope {
    if (raw == null || raw.trim() === "") {
      return "unlisted";
    }
    const s = raw.trim().toLowerCase();
    if (s === "unlisted" || s === "listed_for_sale" || s === "listed_for_auction") {
      return s;
    }
    throw new AppError(
      'Query collectionListing must be "unlisted", "listed_for_sale", or "listed_for_auction".',
      400
    );
  }

  async getOwnedCardFacets(userId: string): Promise<UserOwnedCardFacets> {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }
    return this.repository.getOwnedCardFacets(userId);
  }

  private assertMoneyAmount(amount: string): void {
    const decimalAmount = new Decimal(amount);

    if (!decimalAmount.isFinite() || decimalAmount.decimalPlaces()! > 2) {
      throw new AppError("Amount must be a valid money value with up to 2 decimal places.", 400);
    }

    if (decimalAmount.lessThanOrEqualTo(0)) {
      throw new AppError("Amount must be greater than zero.", 400);
    }
  }

  private normalizeOptionalField(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }
}
