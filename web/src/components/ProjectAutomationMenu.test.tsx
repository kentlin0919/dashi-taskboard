import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectAutomationMenu } from "./ProjectAutomationMenu";
import type { DeviceAutomation } from "../api";

afterEach(cleanup);

it("keeps device default distinct from explicitly choosing the first model", () => {
  const onDeviceChange = vi.fn();
  const models = ["model-A", "model-B"].map((slug) => ({
    slug, displayName: slug, description: "", defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low"], serviceTiers: [],
  }));
  const device: DeviceAutomation = {
    deviceId: "device", deviceName: "Computer", deviceStatus: "active",
    scheduleState: null, lastHeartbeatAt: new Date().toISOString(), lastStatus: { models },
    enabledByUser: true, quotaAware: false, intervalMinutes: 5,
    model: "", reasoningEffort: "", workspacePath: "/project",
  };
  render(<ProjectAutomationMenu deviceMode deviceAutomations={[device]} models={[]}
    pending={false} error={null} unavailableReason={null}
    onOpen={() => {}} onChange={() => {}} onDeviceChange={onDeviceChange} />);
  fireEvent.click(screen.getByRole("button"));
  const picker = screen.getByRole("button", { name: "Model" });
  expect(picker.textContent).toContain("Use device default");
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole("option", { name: "model-A" }));
  expect(onDeviceChange).toHaveBeenCalledWith("device", expect.objectContaining({ model: "model-A", reasoningEffort: "low" }));
  fireEvent.click(screen.getByRole("button", { name: "Model" }));
  fireEvent.click(screen.getByRole("option", { name: "Use device default" }));
  expect(onDeviceChange).toHaveBeenLastCalledWith("device", expect.objectContaining({ model: "", reasoningEffort: "" }));
  expect(screen.queryByRole("button", { name: "Reasoning effort" })).toBeNull();
});
