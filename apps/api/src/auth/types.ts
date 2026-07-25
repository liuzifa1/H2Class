export const HUMAN_ROLES = [
  "admin",
  "staff",
  "teacher",
  "guardian",
] as const;

export type HumanRole = (typeof HUMAN_ROLES)[number];
export type Role = HumanRole | "agent";

export type Principal = {
  id: string;
  roles: Role[];
};
