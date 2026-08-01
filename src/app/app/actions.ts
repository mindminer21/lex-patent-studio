"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/session";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const context = await requireUser();
  if (context.membership) redirect("/app");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    redirect("/app?error=invalid_org_name");
  }
  await createOrganizationForUser(context.user.id, name);
  redirect("/app/terms");
}
