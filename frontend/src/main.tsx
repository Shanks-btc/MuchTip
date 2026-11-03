import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useParams } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./chain/wagmi";
import { AuthErrorRedirect } from "./components/AuthErrorRedirect";
import { ENV_ERRORS } from "./env";
import { ToastProvider } from "./components/ui/Toast";
import { HANDLE_RE } from "./data/api";
import "./index.css";
import { installReveal } from "./lib/reveal";
import Landing from "./pages/Landing";

// The landing page loads first; the app (and supabase-js, used for Sign in with X) loads on demand.
const AppShell = lazy(() => import("./pages/app/AppShell"));
const Send = lazy(() => import("./pages/app/Send"));
const Claim = lazy(() => import("./pages/app/Claim"));
const MyTips = lazy(() => import("./pages/app/MyTips"));
const Activity = lazy(() => import("./pages/app/Activity"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

/** Route changes start at the top, or at #anchor when the URL has one. A sign-in error on any page goes to Claim. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    // (scroll methods return a Promise in current Chrome, so never return their result from an effect)
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const t = setTimeout(() => void document.getElementById(hash.slice(1))?.scrollIntoView(), 50);
    return () => clearTimeout(t);
  }, [pathname, hash]);
  return (
    <AuthErrorRedirect>
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <Outlet />
      </Suspense>
    </AuthErrorRedirect>
  );
}

/** /@handle is a tip link: Send with the handle filled in. Any other single segment is a 404. */
function HandleOr404() {
  const { segment = "" } = useParams();
  const handle = segment.startsWith("@") ? segment.slice(1) : "";
  return HANDLE_RE.test(handle) ? <Navigate to={`/app?to=${encodeURIComponent(handle)}`} replace /> : <NotFound />;
}

/**
 * v4 URLs keep working, query and hash included (the X sign-in return carries its result there). v4's /tip?to=&amount=
 * opened the review step, so that lands on Send's review (?step=review) rather than the empty form.
 */
function Moved({ to, review = false }: { to: string; review?: boolean }) {
  const { search, hash } = useLocation();
  const q = new URLSearchParams(search);
  if (review && q.get("to") && q.get("amount") && !q.get("tx")) q.set("step", "review");
  const qs = q.toString();
  return <Navigate to={`${to}${qs ? `?${qs}` : ""}${hash === "#send" ? "" : hash}`} replace />;
}

/** v4's "Edit" link went to /?to=handle&amount=25#send (the landing send card); that card now lives at /app. */
function LandingOrSend() {
  const { search } = useLocation();
  return new URLSearchParams(search).has("to") ? <Moved to="/app" /> : <Landing />;
}

const router = createBrowserRouter([
  {
    element: <ScrollManager />,
    children: [
      { path: "/", element: <LandingOrSend /> },
      {
        path: "/app",
        element: <AppShell />,
        children: [
          { index: true, element: <Send /> },
          { path: "claim", element: <Claim /> },
          { path: "tips", element: <MyTips /> },
          { path: "activity", element: <Activity /> },
          { path: "*", element: <Navigate to="/app" replace /> },
        ],
      },
      { path: "/tip", element: <Moved to="/app" review /> },
      { path: "/claim", element: <Moved to="/app/claim" /> },
      { path: "/me", element: <Moved to="/app/tips" /> },
      { path: "/feed", element: <Moved to="/app/activity" /> },
      { path: "/:segment", element: <HandleOr404 /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

installReveal();

/** A malformed VITE_* value (src/env.ts): one clear screen naming what to fix, instead of a blank page. */
function EnvErrorScreen({ errors }: { errors: string[] }) {
  return (
    <main className="mx-auto max-w-[620px] px-6 py-24 font-sans text-ink">
      <h1 className="m-0 text-[28px]">MuchTip can't start</h1>
      <p className="m-0 mt-3 text-[15px] leading-[1.55] text-ink-3">The build's environment has a problem. Fix it in frontend/.env.local (see .env.example), then restart.</p>
      <ul className="mt-5 list-disc pl-5 font-mono text-[13px] leading-[1.7]">
        {errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
if (ENV_ERRORS.length) root.render(<EnvErrorScreen errors={ENV_ERRORS} />);
else root.render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
