import type { GroupRepository } from "../db/group-repository";
import type { UserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { createGroup, type Group } from "../group";

/** 一覧の1行分 */
export type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  memberCount: number;
};

/** 詳細のメンバー1人分 */
export type GroupMemberDetail = { id: string; name: string };

/** メンバーの名前を含むグループの詳細 */
export type GroupDetail = {
  id: string;
  name: string;
  ownerId: string;
  members: GroupMemberDetail[];
};

export const UNKNOWN_MEMBER_NAME = "不明な利用者";

export async function createGroupByUser(
  groups: GroupRepository,
  userId: string,
  name: string,
): Promise<Group> {
  const group = createGroup(name, userId);
  await groups.insert(group);
  return group;
}

export async function listGroupsOfUser(
  groups: GroupRepository,
  userId: string,
): Promise<GroupSummary[]> {
  const list = await groups.listByMember(userId);
  return list
    .slice()
    .reverse()
    .map((g) => ({ id: g.id, name: g.name, ownerId: g.ownerId, memberCount: g.members.length }));
}

export async function findGroupAsMember(
  groups: GroupRepository,
  groupId: string,
  userId: string,
): Promise<Group> {
  const group = await groups.findById(groupId);
  if (!group || !group.members.includes(userId)) {
    throw new DomainError("not_found", "グループが見つかりません");
  }
  return group;
}

export async function getGroupDetail(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  const group = await findGroupAsMember(groups, groupId, userId);
  const members: GroupMemberDetail[] = [];
  for (const id of group.members) {
    const user = await users.findById(id);
    members.push({ id, name: user?.name ?? UNKNOWN_MEMBER_NAME });
  }
  return { id: group.id, name: group.name, ownerId: group.ownerId, members };
}
