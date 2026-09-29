"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-client";
import type { GroupDetail, GroupMemberDetail } from "../server/groups";
import { ConfirmDialog } from "./confirm-dialog";

export type MemberListProps = {
  groupId: string;
  members: Array<GroupMemberDetail>;
  ownerId: string;
  currentUserId: string;
  onOwnerTransferred: (group: GroupDetail) => void;
};

export function MemberList({
  groupId,
  members,
  ownerId,
  currentUserId,
  onOwnerTransferred,
}: MemberListProps): React.JSX.Element {
  const [target, setTarget] = useState<GroupMemberDetail | null>(null);
  const [pending, setPending] = useState(false);
  const isOwner = ownerId === currentUserId;

  async function handleConfirm(): Promise<void> {
    if (!target) return;
    setPending(true);
    const result = await apiFetch<{ group: GroupDetail }>(`/api/groups/${groupId}/owner`, {
      method: "PUT",
      body: { userId: target.id },
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`オーナーを${target.name}さんに変更しました`);
    setTarget(null);
    onOwnerTransferred(result.data.group);
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex items-center gap-2 text-foreground">
              {member.name}
              {member.id === currentUserId ? "（あなた）" : null}
              {member.id === ownerId ? <Badge variant="secondary">オーナー</Badge> : null}
            </span>
            {isOwner && member.id !== currentUserId ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`${member.name}さんの操作`}>
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setTarget(member)}>
                    オーナーにする
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setTarget(null);
        }}
        title={`${target?.name ?? ""}さんをオーナーにしますか？`}
        description="委譲するとあなたはグループ名の変更やメンバーの追加ができなくなります。"
        confirmLabel="オーナーにする"
        pendingLabel="変更中…"
        pending={pending}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}
