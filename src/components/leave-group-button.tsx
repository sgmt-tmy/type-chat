"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { ConfirmDialog } from "./confirm-dialog";

export type LeaveGroupButtonProps = {
  groupId: string;
  groupName: string;
};

export function LeaveGroupButton({
  groupId,
  groupName,
}: LeaveGroupButtonProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    const result = await apiFetch<null>(`/api/groups/${groupId}/members/me`, {
      method: "DELETE",
    });
    setPending(false);
    if (result.ok) {
      toast.success(`「${groupName}」から脱退しました`);
      setOpen(false);
      router.replace("/");
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        グループから脱退
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`「${groupName}」から脱退しますか？`}
        description="脱退すると、このグループのメッセージを読んだり送ったりできなくなります。もう一度参加するには、オーナーに追加してもらう必要があります。"
        confirmLabel="脱退する"
        pendingLabel="脱退中…"
        destructive
        pending={pending}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}
