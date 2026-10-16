import { describe, it, expect } from "vitest";
import { createSignupToken, verifySignupToken } from "@/lib/signup-token";
import { validateEmailAddress } from "@/lib/email-validator";

describe("Sign-up Email Verification", () => {
  it("rejects disposable email addresses", async () => {
    const result = await validateEmailAddress("scammer@yopmail.com", "fr");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("jetables");
  });

  it("detects common email typos", async () => {
    const result = await validateEmailAddress("user@gmai.com", "fr");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("gmail.com");
  });

  it("rejects non-existent domain without DNS MX records", async () => {
    const result = await validateEmailAddress("test@thisdomaindoesnotexist123456789.xyz", "fr");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("n'existe pas");
  });

  it("accepts valid email with real domain", async () => {
    const result = await validateEmailAddress("contact@divaasso.com", "fr");
    expect(result.valid).toBe(true);
    expect(result.normalizedEmail).toBe("contact@divaasso.com");
  });

  it("creates and verifies a signed signup token", () => {
    const token = createSignupToken({
      fullName: "Marie Doe",
      email: "marie@example.com",
      password: "password123",
      code: "123456",
      expiresAt: Date.now() + 60_000,
    });

    expect(token).toBeTruthy();
    const verified = verifySignupToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.fullName).toBe("Marie Doe");
    expect(verified?.email).toBe("marie@example.com");
    expect(verified?.code).toBe("123456");
  });

  it("rejects tampered or corrupt tokens", () => {
    const token = createSignupToken({
      fullName: "Test",
      email: "test@example.com",
      password: "pass",
      code: "654321",
      expiresAt: Date.now() + 60_000,
    });

    const tampered = token.slice(0, -4) + "XXXX";
    expect(verifySignupToken(tampered)).toBeNull();
    expect(verifySignupToken("completely-invalid-token")).toBeNull();
  });
});
