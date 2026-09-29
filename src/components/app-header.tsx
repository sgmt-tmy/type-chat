import Link from "next/link";

export function AppHeader(): React.JSX.Element {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-foreground">
          type-chat
        </Link>
        <div />
      </div>
    </header>
  );
}
