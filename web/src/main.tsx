import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DevicePairingBootstrap } from "./components/DevicePairingBootstrap";
import { initializeTaskboardStorage } from "./storage";
import "./styles.css";

async function main() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("taskboard-device-pair") === "1") {
    const state = url.searchParams.get("state") ?? "";
    const callbackUrl = url.searchParams.get("callback") ?? "";
    const deviceName = url.searchParams.get("deviceName") ?? "This computer";
    window.history.replaceState(null, "", url.pathname);
    createRoot(document.getElementById("root")!).render(
      <DevicePairingBootstrap
        state={state}
        callbackUrl={callbackUrl}
        deviceName={deviceName}
      />,
    );
    return;
  }

  await initializeTaskboardStorage();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
