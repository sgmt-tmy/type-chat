"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { GROUP_NAME_MAX_LENGTH } from "../group";
import type { GroupDetail } from "../server/groups";

export const RENAME_GROUP_NAME_INPUT_ID = "rename-group-name";

const ERROR_ID = "rename-group-name-error";
const NAME_EMPTY = "グループ名は空にできません";
const NAME_TOO_LONG = `グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`;

export type RenameGroupFormProps = {
  groupId: string;
  currentName: string;
  onRenamed: (group: GroupDetail) => void;
};

export function RenameGroupForm({
  groupId,
  currentName,
  onRenamed,
}: RenameGroupFormProps): React.JSX.Element {
  const [name, setName] = useState(currentName);
  const [previousName, setPreviousName] = useState(currentName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (currentName !== previousName) {
    setPreviousName(currentName);
    if (name.trim() === previousName) setName(currentName);
  }

  const unchanged = name.trim() === currentName;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || unchanged) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError(NAME_EMPTY);
      return;
    }
    if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
      setNameError(NAME_TOO_LONG);
      return;
    }
    setNameError(null);
    setSaving(true);
    const result = await apiFetch<{ group: GroupDetail }>(`/api/groups/${groupId}`, {
      method: "PATCH",
      body: { name },
    });
    setSaving(false);
    if (result.ok) {
      toast.success("グループ名を変更しました");
      setName(result.data.group.name);
      onRenamed(result.data.group);
    } else if (result.error.code === "validation" || result.error.code === "conflict") {
      setNameError(result.error.message);
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={RENAME_GROUP_NAME_INPUT_ID}>グループ名</Label>
        <Input
          id={RENAME_GROUP_NAME_INPUT_ID}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? ERROR_ID : undefined}
        />
        {nameError ? (
          <p id={ERROR_ID} className="text-sm text-destructive">
            {nameError}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="default" disabled={saving || unchanged}>
        {saving ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
