import { notFound } from "next/navigation";
import { GroupSettingsView } from "@/components/group-settings-view";
import { getDb } from "@/db/client";
import { createGroupRepository } from "@/db/group-repository";
import { createUserRepository } from "@/db/user-repository";
import { DomainError } from "@/errors";
import { getGroupDetail, type GroupDetail } from "@/server/groups";
import { requireCurrentUserInPage } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function GroupSettingsPage(props: {
  params: Promise<{ groupId: string }>;
}): Promise<React.JSX.Element> {
  const user = await requireCurrentUserInPage();
  const { groupId } = await props.params;
  const db = getDb();
  let group: GroupDetail;
  try {
    group = await getGroupDetail(
      createGroupRepository(db),
      createUserRepository(db),
      groupId,
      user.id,
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "not_found") notFound();
    throw error;
  }
  return <GroupSettingsView groupId={group.id} currentUserId={user.id} initialGroup={group} />;
}
