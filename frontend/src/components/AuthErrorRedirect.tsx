import { Navigate, useLocation } from "react-router-dom";
import { authErrorTarget } from "../lib/authError";

/** In the root layout: a sign-in error on any page other than Claim goes to Claim, params kept (lib/authError.ts). */
export function AuthErrorRedirect({ children }: { children: React.ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const target = authErrorTarget(pathname, search, hash);
  return target ? <Navigate to={target} replace /> : <>{children}</>;
}
