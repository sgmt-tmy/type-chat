import { redirect } from "next/navigation";
import { StartForm } from "@/components/start-form";
import { getDb } from "../../db/client";
import { createUserRepository } from "../../db/user-repository";
import { getCurrentUserInPage } from "../../server/session";
import { listUsers } from "../../server/users";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const current = await getCurrentUserInPage();
  if (current) redirect("/");

  const users = await listUsers(createUserRepository(getDb()));
  return (
    <div className="space-y-6 py-6">
      <h1 className="text-2xl font-semibold text-foreground">type-chat をはじめる</h1>
      <StartForm users={users.map((user) => ({ id: user.id, name: user.name }))} />
    </div>
  );
}
