import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export type ChatHeaderProps = { groupId: string; groupName: string };

export function ChatHeader({ groupId, groupName }: ChatHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3">
      <Link
        href="/"
        className="flex shrink-0 items-center gap-1 text-sm text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        戻る
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-center text-lg font-semibold text-foreground">
        {groupName}
      </h1>
      <Link
        href={`/groups/${groupId}/settings`}
        className="shrink-0 text-sm text-foreground hover:underline"
      >
        設定
      </Link>
    </div>
  );
}
