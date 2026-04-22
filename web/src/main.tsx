import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CaptureApp } from "./CaptureApp";
import { MarketplaceApp } from "./MarketplaceApp";
import { RoleProfileApp } from "./RoleProfileApp";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const app = params.get("app");
const initialPayload =
  window.openai?.toolOutput &&
  typeof window.openai.toolOutput === "object" &&
  "structuredContent" in (window.openai.toolOutput as Record<string, unknown>)
    ? (window.openai.toolOutput as { structuredContent?: unknown }).structuredContent
    : window.openai?.toolOutput;
const isRoleProfileWidget = Boolean(
  initialPayload &&
    typeof initialPayload === "object" &&
    "availableDrafts" in (initialPayload as Record<string, unknown>) &&
    "pendingQuestions" in (initialPayload as Record<string, unknown>)
);
const isMarketplaceWidget = Boolean(
  initialPayload &&
    typeof initialPayload === "object" &&
    "overview" in (initialPayload as Record<string, unknown>) &&
    "movementHistory" in (initialPayload as Record<string, unknown>) &&
    "jobMatches" in (initialPayload as Record<string, unknown>)
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {app === "capture" ? (
      <CaptureApp />
    ) : app === "marketplace" || isMarketplaceWidget ? (
      <MarketplaceApp />
    ) : app === "role-profile" || isRoleProfileWidget ? (
      <RoleProfileApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
