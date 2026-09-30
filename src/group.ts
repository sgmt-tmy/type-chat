import { DomainError } from "./errors";

export type Group = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
};

export const GROUP_NAME_MAX_LENGTH = 50;

export function createGroup(name: string, ownerId: string): Group {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new DomainError("validation", "グループ名は空にできません");
  }
  if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
    throw new DomainError(
      "validation",
      `グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`,
    );
  }
  return { id: crypto.randomUUID(), name: trimmed, ownerId, members: [ownerId] };
}

export function addMember(group: Group, requesterId: string, userId: string): Group {
  if (requesterId !== group.ownerId) {
    throw new DomainError("forbidden", "メンバーの追加はオーナーのみ可能です");
  }
  if (group.members.includes(userId)) {
    return group;
  }
  return { ...group, members: [...group.members, userId] };
}

export function leaveGroup(group: Group, requesterId: string): Group {
  if (!group.members.includes(requesterId)) {
    throw new DomainError("not_found", "グループのメンバーではありません");
  }
  if (requesterId === group.ownerId) {
    throw new DomainError("forbidden", "オーナーは脱退できません。先にオーナーを委譲してください");
  }
  return { ...group, members: group.members.filter((id) => id !== requesterId) };
}

export function removeMember(group: Group, userId: string): Group {
  if (userId === group.ownerId) {
    throw new DomainError("conflict", "オーナーは削除できません");
  }
  return { ...group, members: group.members.filter((id) => id !== userId) };
}

export function renameGroup(group: Group, requesterId: string, newName: string): Group {
  if (requesterId !== group.ownerId) {
    throw new DomainError("forbidden", "グループ名の変更はオーナーのみ可能です");
  }
  const trimmed = newName.trim();
  if (trimmed === "") {
    throw new DomainError("validation", "グループ名は空にできません");
  }
  if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
    throw new DomainError(
      "validation",
      `グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`,
    );
  }
  return { ...group, name: trimmed };
}

export function transferOwner(group: Group, requesterId: string, newOwnerId: string): Group {
  if (requesterId !== group.ownerId) {
    throw new DomainError("forbidden", "オーナー権限の委譲はオーナーのみ可能です");
  }
  if (newOwnerId === group.ownerId) {
    throw new DomainError("validation", "委譲先が現在のオーナーと同じです");
  }
  if (!group.members.includes(newOwnerId)) {
    throw new DomainError("validation", "委譲先はグループのメンバーである必要があります");
  }
  return { ...group, ownerId: newOwnerId };
}
