"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { GROUP_NAME_MAX_LENGTH } from "../group";

export const CREATE_GROUP_NAME_INPUT_ID = "create-group-name";

const ERROR_ID = "create-group-name-error";
const NAME_EMPTY = "グループ名は空にできません";
const NAME_TOO_LONG = `グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`;

export function CreateGroupForm(): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
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
    setCreating(true);
    const result = await apiFetch<{ group: { id: string } }>("/api/groups", {
      method: "POST",
      body: { name },
    });
    setCreating(false);
    if (result.ok) {
      toast.success("グループを作成しました");
      router.push(`/groups/${result.data.group.id}`);
    } else if (result.error.code === "validation" || result.error.code === "conflict") {
      setNameError(result.error.message);
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={CREATE_GROUP_NAME_INPUT_ID}>グループ名</Label>
        <Input
          id={CREATE_GROUP_NAME_INPUT_ID}
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
      <Button type="submit" variant="default" disabled={creating}>
        {creating ? "作成中…" : "作成"}
      </Button>
    </form>
  );
}
