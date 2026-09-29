export type EmptyStateProps = {
  title: string;
  description: string;
  action: React.ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
