import { expect, type Page } from "@playwright/test";

export const ADMIN = "brainpopresearch@gmail.com";
export const RESEARCHER = "researcher@brainpop.example";
export const REVIEWER = "reviewer@brainpop.example";
export const STRANGER = "stranger@gmail.com";

/**
 * Sign in through the emulator build's Google identity form. The Auth emulator
 * issues a genuine ID token with provider google.com — the same thing Google
 * sign-in produces in production.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Emulated Google account").fill(email);
  await page.getByRole("button", { name: "Sign in (emulator)" }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
