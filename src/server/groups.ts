import type { GroupRepository } from "../db/group-repository";
import type { UserRepository } from "../db/user-repository";
import { DomainError } from "../errors";
import { addMember, createGroup, leaveGroup, renameGroup, transferOwner, type Group } from "../group";
import { publish } from "./events";

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

async function toGroupDetail(users: UserRepository, group: Group): Promise<GroupDetail> {
  const members: GroupMemberDetail[] = [];
  for (const id of group.members) {
    const user = await users.findById(id);
    members.push({ id, name: user?.name ?? UNKNOWN_MEMBER_NAME });
  }
  return { id: group.id, name: group.name, ownerId: group.ownerId, members };
}

export async function getGroupDetail(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  const group = await findGroupAsMember(groups, groupId, userId);
  return toGroupDetail(users, group);
}

export async function renameGroupByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  name: string,
): Promise<GroupDetail> {
  const before = await findGroupAsMember(groups, groupId, userId);
  const after = renameGroup(before, userId, name);
  await groups.save(after);
  publish({ type: "group.updated", data: { group: after } }, [
    ...new Set([...before.members, ...after.members]),
  ]);
  return toGroupDetail(users, after);
}

export async function transferOwnerByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  newOwnerId: string,
): Promise<GroupDetail> {
  const before = await findGroupAsMember(groups, groupId, userId);
  const after = transferOwner(before, userId, newOwnerId);
  await groups.save(after);
  publish({ type: "group.updated", data: { group: after } }, [
    ...new Set([...before.members, ...after.members]),
  ]);
  return toGroupDetail(users, after);
}

export async function addMemberByUser(
  groups: GroupRepository,
  users: UserRepository,
  groupId: string,
  userId: string,
  memberUserId: string,
): Promise<GroupDetail> {
  const before = await findGroupAsMember(groups, groupId, userId);
  const after = addMember(before, userId, memberUserId);
  if ((await users.findById(memberUserId)) === null) {
    throw new DomainError("not_found", "利用者が見つかりません");
  }
  if (after !== before) {
    await groups.save(after);
    publish({ type: "group.updated", data: { group: after } }, [
      ...new Set([...before.members, ...after.members]),
    ]);
  }
  return toGroupDetail(users, after);
}

export async function leaveGroupByUser(
  groups: GroupRepository,
  groupId: string,
  userId: string,
): Promise<void> {
  const before = await findGroupAsMember(groups, groupId, userId);
  const after = leaveGroup(before, userId);
  await groups.save(after);
  publish({ type: "group.updated", data: { group: after } }, [
    ...new Set([...before.members, ...after.members]),
  ]);
}
