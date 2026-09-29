import { CreateGroupForm } from "@/components/create-group-form";
import { GroupList } from "@/components/group-list";
import { requireCurrentUserInPage } from "../server/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireCurrentUserInPage();
  return (
    <div className="space-y-6 py-6">
      <h1 className="text-2xl font-semibold text-foreground">グループ</h1>
      <CreateGroupForm />
      <GroupList currentUserId={user.id} />
    </div>
  );
}
