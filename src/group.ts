export type Group = {
  name: string;
  ownerId: string;
  members: string[];
};

export function createGroup(name: string, ownerId: string): Group {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("グループ名は空にできません");
  }
  return { name: trimmed, ownerId, members: [ownerId] };
}

export function addMember(group: Group, userId: string): Group {
  if (group.members.includes(userId)) {
    return group;
  }
  return { ...group, members: [...group.members, userId] };
}

export function removeMember(group: Group, userId: string): Group {
  if (userId === group.ownerId) {
    throw new Error("オーナーは削除できません");
  }
  return { ...group, members: group.members.filter((id) => id !== userId) };
}

export const GROUP_NAME_MAX_LENGTH = 50;

export function renameGroup(group: Group, requesterId: string, newName: string): Group {
  if (requesterId !== group.ownerId) {
    throw new Error("グループ名の変更はオーナーのみ可能です");
  }
  const trimmed = newName.trim();
  if (trimmed === "") {
    throw new Error("グループ名は空にできません");
  }
  if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
    throw new Error(`グループ名は${GROUP_NAME_MAX_LENGTH}文字以内で入力してください`);
  }
  return { ...group, name: trimmed };
}
