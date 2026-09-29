import Link from "next/link";
import { UserMenu } from "@/components/user-menu";

export type AppHeaderProps = { userName?: string | null };

export function AppHeader({ userName }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-foreground">
          type-chat
        </Link>
        {userName ? <UserMenu userName={userName} /> : <div />}
      </div>
    </header>
  );
}
