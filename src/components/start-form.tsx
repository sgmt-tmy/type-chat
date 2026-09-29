"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";

export type StartFormProps = { users: Array<{ id: string; name: string }> };

const NAME_MAX_LENGTH = 30;
const NAME_TOO_LONG = "ユーザー名は30文字以内で入力してください";

export function StartForm({ users }: StartFormProps): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const busy = creating || switchingId !== null;
  const trimmed = name.trim();

  function enter(message: string) {
    toast.success(message);
    router.replace("/");
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed === "" || busy) return;
    if (trimmed.length > NAME_MAX_LENGTH) {
      setNameError(NAME_TOO_LONG);
      return;
    }
    setNameError(null);
    setCreating(true);
    const result = await apiFetch("/api/users", { method: "POST", body: { name } });
    setCreating(false);
    if (result.ok) {
      enter("利用を開始しました");
    } else if (result.error.code === "validation" || result.error.code === "conflict") {
      setNameError(result.error.message);
    } else {
      toast.error(result.error.message);
    }
  }

  async function handleSwitch(userId: string) {
    if (busy) return;
    setSwitchingId(userId);
    const result = await apiFetch("/api/session", { method: "PUT", body: { userId } });
    setSwitchingId(null);
    if (result.ok) {
      enter("利用を再開しました");
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="start-name">名前</Label>
          <Input
            id="start-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "start-name-error" : undefined}
          />
          {nameError ? (
            <p id="start-name-error" className="text-sm text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="default" disabled={trimmed === "" || busy}>
          {creating ? "開始中…" : "はじめる"}
        </Button>
      </form>

      {users.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">前に使った名前で入り直す</h2>
          <ul className="flex flex-wrap gap-2">
            {users.map((user) => (
              <li key={user.id}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleSwitch(user.id)}
                >
                  {switchingId === user.id ? "切り替え中…" : user.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
