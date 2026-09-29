"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-client";

export type UserMenuProps = { userName: string };

export function UserMenu({ userName }: UserMenuProps): React.JSX.Element {
  const router = useRouter();

  async function handleSwitch() {
    const result = await apiFetch("/api/session", { method: "DELETE" });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("利用を終了しました");
    router.replace("/start");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{userName}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleSwitch}>利用者を切り替える</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
