"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import type { GroupDetail } from "../server/groups";

export const ADD_MEMBER_SELECT_ID = "add-member-user";

export type AddMemberFormProps = {
  groupId: string;
  candidates: Array<{ id: string; name: string }>;
  onAdded: (group: GroupDetail) => void;
};

export function AddMemberForm({
  groupId,
  candidates,
  onAdded,
}: AddMemberFormProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState(false);

  const selected = candidates.find((c) => c.id === selectedId);
  if (selectedId !== "" && !selected) setSelectedId("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || !selected) return;
    setAdding(true);
    const result = await apiFetch<{ group: GroupDetail }>(`/api/groups/${groupId}/members`, {
      method: "POST",
      body: { userId: selected.id },
    });
    setAdding(false);
    if (result.ok) {
      toast.success(`${selected.name}さんを追加しました`);
      setSelectedId("");
      onAdded(result.data.group);
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">メンバーを追加</h3>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">追加できる利用者がいません</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={ADD_MEMBER_SELECT_ID}>追加する利用者</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger id={ADD_MEMBER_SELECT_ID}>
                <SelectValue placeholder="利用者を選択" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="secondary" disabled={adding || !selected}>
            {adding ? "追加中…" : "追加"}
          </Button>
        </form>
      )}
    </div>
  );
}
