export type Group = {
  name: string;
  ownerId: string;
  members: string[];
};

export function createGroup(name: string, ownerId: string): Group {
  const trimmed = name.trim();
  if (trimmed !== "") {
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
