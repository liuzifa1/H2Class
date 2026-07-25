import type { MeResponse } from "@h2class/shared";
import type { Principal } from "../../auth/types";

export const getMe = (principal: Principal | undefined): MeResponse => {
  if (principal === undefined) {
    throw new Error("Authenticated route is missing its principal");
  }
  return principal;
};
