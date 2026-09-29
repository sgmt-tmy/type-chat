"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import type { GroupDetail } from "../server/groups";
import { MemberList } from "./member-list";
import { RenameGroupForm } from "./rename-group-form";
import { useLiveEvents } from "./use-live-events";

export type GroupSettingsViewProps = {
  groupId: string;
  currentUserId: string;
  initialGroup: GroupDetail;
};

export function GroupSettingsView({
  groupId,
  currentUserId,
  initialGroup,
}: GroupSettingsViewProps): React.JSX.Element {
  const [group, setGroup] = useState(initialGroup);
  const latestRequest = useRef(0);
  const isOwner = group.ownerId === currentUserId;

  const refetch = useCallback((): void => {
    const requestId = ++latestRequest.current;
    void apiFetch<{ group: GroupDetail }>(`/api/groups/${groupId}`).then((result) => {
      if (requestId !== latestRequest.current) return;
      if (result.ok) setGroup(result.data.group);
      else toast.error(result.error.message);
    });
  }, [
    groupId,
  ]);

  useLiveEvents({
    handlers: {
      "group.updated": (data) => {
        if (data.group.id === groupId) refetch();
      },
    },
    onReconnect: refetch,
  });

  return (
    <div className="space-y-6 py-4">
      <Link
        href={`/groups/${groupId}`}
        className="flex w-fit items-center gap-1 text-sm text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        チャットに戻る
      </Link>
      <h1 className="text-xl font-semibold text-foreground">グループ設定</h1>
      <Card>
        <CardHeader>
          <h2 className="text-base font-medium text-foreground">グループ名</h2>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <RenameGroupForm groupId={groupId} currentName={group.name} onRenamed={setGroup} />
          ) : (
            <div className="space-y-1">
              <p className="text-foreground">{group.name}</p>
              <p className="text-sm text-muted-foreground">グループ名はオーナーだけが変更できます</p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-base font-medium text-foreground">メンバー</h2>
        </CardHeader>
        <CardContent>
          <MemberList
            groupId={groupId}
            members={group.members}
            ownerId={group.ownerId}
            currentUserId={currentUserId}
            onOwnerTransferred={setGroup}
          />
        </CardContent>
      </Card>
    </div>
  );
}
