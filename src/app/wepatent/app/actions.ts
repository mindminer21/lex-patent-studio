"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/session";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const context = await requireUser();
  if (context.membership) redirect("/wepatent/app");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    redirect("/wepatent/app?error=invalid_org_name");
  }
  await createOrganizationForUser(context.user.id, name);
  redirect("/wepatent/app/terms");
}
