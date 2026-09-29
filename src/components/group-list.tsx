"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveEvents } from "@/components/use-live-events";
import { apiFetch } from "@/lib/api-client";
import type { GroupSummary } from "../server/groups";
import { CREATE_GROUP_NAME_INPUT_ID } from "./create-group-form";

export type GroupListProps = { currentUserId: string };

export function GroupList({ currentUserId }: GroupListProps): React.JSX.Element {
  const [groups, setGroups] = useState<Array<GroupSummary> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const latestRequest = useRef(0);

  const request = useCallback((): Promise<void> => {
    const requestId = ++latestRequest.current;
    return apiFetch<{ groups: Array<GroupSummary> }>("/api/groups").then((result) => {
      if (requestId !== latestRequest.current) return;
      if (result.ok) {
        setGroups(result.data.groups);
      } else {
        toast.error(result.error.message);
        setLoadFailed(true);
      }
    });
  }, [
  ]);

  useEffect(() => {
    void request();
  }, [
    request,
  ]);

  useLiveEvents({
    handlers: {
      "group.updated": () => void request(),
      "group.deleted": () => void request(),
    },
    onReconnect: () => void request(),
  });

  if (groups === null && !loadFailed) {
    return (
      <div aria-busy="true" className="space-y-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (groups === null) {
    return (
      <EmptyState
        title="グループを読み込めませんでした"
        description="接続を確認して、もう一度お試しください"
        action={
          <Button type="button" variant="outline" onClick={() => void request()}>
            再読み込み
          </Button>
        }
      />
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="まだグループがありません"
        description="グループ名を入力して、最初のグループを作りましょう"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => document.getElementById(CREATE_GROUP_NAME_INPUT_ID)?.focus()}
          >
            グループ名を入力する
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {groups.map((group) => (
        <li key={group.id}>
          <Link
            href={`/groups/${group.id}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-4 hover:bg-muted"
          >
            <span className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{group.name}</span>
              <span className="text-sm text-muted-foreground">メンバー {group.memberCount}人</span>
            </span>
            {group.ownerId === currentUserId ? <Badge variant="secondary">オーナー</Badge> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
