export type Group = {
  name: string;
  ownerId: string;
};

export function createGroup(name: string, ownerId: string): Group {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("グループ名は空にできません");
  }
  return { name: trimmed, ownerId };
}
