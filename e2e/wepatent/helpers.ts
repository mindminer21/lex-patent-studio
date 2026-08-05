import { expect, type Page } from "@playwright/test";

/**
 * Accessible name of the file input, which differs by surface:
 * - an empty record shows the first-run drag-and-drop area labeled
 *   "Upload Anything About the Invention" (Jeff's copy, verbatim);
 * - once the record has content the workspace shows the compact control
 *   labeled "File (documents: …)".
 *
 * Both are the SAME control and the same FR-4 pipeline, so specs target
 * them by accessible name through this one pattern.
 */
export const UPLOAD_INPUT_LABEL =
  /^(File \(documents|Upload Anything About the Invention)/;

/** The record navigation after the ten → five tab reduction. */
export const RECORD_TABS = ["Overview", "Studio", "Drafts", "Figures", "Export"];

/** Signs in through the real form; local mode creates the synthetic user. */
export async function signIn(page: Page, email: string, name: string): Promise<void> {
  await page.goto("/wepatent/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Display name (optional)").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/(wepatent\/app|counsel)/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/wepatent$/);
}

/**
 * Mirror of `defaultOrganizationName` (services/orgs.ts): the first
 * organization is auto-created on first sign-in with a placeholder name
 * derived from the email local-part — there is no "Create organization"
 * step to walk through any more (friction audit candidate 5).
 */
export function placeholderOrgName(email: string): string {
  const words = (email.split("@")[0] ?? "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((segment) => segment.length > 0 && !/^\d+$/.test(segment))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .slice(0, 4);
  return words.length === 0 ? "My workspace" : `${words.join(" ")}'s workspace`;
}

/**
 * Completes the versioned clickwrap with the KEYBOARD only (PRD §13):
 * every acknowledgement is toggled with Space, submission with Enter, and
 * the Continue button must stay disabled until all four are checked.
 */
export async function acceptClickwrapByKeyboard(page: Page): Promise<void> {
  const continueButton = page.getByRole("button", { name: "Continue to the workspace" });
  await expect(continueButton).toBeDisabled();

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await checkboxes.nth(index).focus();
    await page.keyboard.press("Space");
    if (index < 3) await expect(continueButton).toBeDisabled();
  }
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/wepatent\/app$/);
}

/**
 * Fresh tenant: sign-in (organization auto-created) → clickwrap. The
 * organization-creation step no longer exists; sign-in lands directly on
 * the clickwrap, which remains a required explicit step.
 */
export async function onboardFreshTenant(
  page: Page,
  slug: string,
): Promise<{ email: string; orgName: string }> {
  const unique = `${slug}-${Date.now()}`;
  const email = `${unique}@example.test`;
  await signIn(page, email, `User ${unique}`);
  await page.waitForURL(/\/wepatent\/app\/terms/);
  await acceptClickwrapByKeyboard(page);
  return { email, orgName: placeholderOrgName(email) };
}
