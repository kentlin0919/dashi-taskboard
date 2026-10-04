import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LinearIcon } from "./LinearIcon";
import { ProjectIcon, RecurrenceIcon } from "./SemanticIcons";
import { TaskPropertyPicker } from "./TaskPropertyPicker";
import { TaskboardIcon } from "./TaskboardIcon";
import { useTaskboardI18n } from "../i18n";
import { listenForMenuViewportChange, listenForOutsidePointerDown } from "../menuEvents";
import type { AiChatModel } from "../types";
import type { DeviceAutomation } from "../api";

type AutomationStatus = "ACTIVE" | "PAUSED";
type AutomationQuotaState = "available" | "blocked" | "unknown" | "unavailable";
type IntervalMinutes = 5 | 10 | 15 | 30 | 60;

interface AutomationOptions {
  enabledByUser: boolean;
  quotaAware: boolean;
  intervalMinutes: IntervalMinutes;
  model: string;
  reasoningEffort: string;
  workspacePath?: string;
}

interface AutomationState extends AutomationOptions {
  status: AutomationStatus;
  idleReason?: "checking-todos" | "waiting-todos";
  quota?: {
    state: AutomationQuotaState;
    checkedAt: number;
    resetsAt?: number;
    reason?: "api-key";
  };
}

interface ProjectAutomationMenuProps {
  automation?: Partial<AutomationState>;
  deviceAutomations?: DeviceAutomation[];
  deviceMode?: boolean;
  models: AiChatModel[];
  pending: boolean;
  error: string | null;
  unavailableReason: string | null;
  onOpen: () => void;
  onChange: (options: AutomationOptions) => void;
  onDeviceChange?: (deviceId: string, options: AutomationOptions) => void;
  onOpenDeviceManagement?: () => void;
}

const EFFORT_LABELS: Record<string, readonly [string, string]> = {
  low: ["轻度", "Low"],
  medium: ["中", "Medium"],
  high: ["高", "High"],
  xhigh: ["极高 (xhigh)", "Extra high (xhigh)"],
  max: ["最高", "Maximum"],
  ultra: ["极高 (ultra)", "Ultra"],
};

function automationOptions(
  models: AiChatModel[],
  automation?: Partial<AutomationState>,
): AutomationOptions {
  const model = models.find((candidate) => candidate.slug === automation?.model) ?? models[0];
  const reasoningEffort = model?.supportedReasoningEfforts.includes(automation?.reasoningEffort ?? "")
    ? automation?.reasoningEffort
    : model?.defaultReasoningEffort;
  return {
    enabledByUser: automation?.enabledByUser ?? false,
    quotaAware: automation?.quotaAware ?? false,
    intervalMinutes: automation?.intervalMinutes ?? 5,
    model: model?.slug ?? "",
    reasoningEffort: reasoningEffort ?? "",
  };
}

export function ProjectAutomationMenu({
  automation,
  deviceAutomations,
  deviceMode = false,
  models,
  pending,
  error,
  unavailableReason,
  onOpen,
  onChange,
  onDeviceChange,
  onOpenDeviceManagement,
}: ProjectAutomationMenuProps) {
  const { locale, text } = useTaskboardI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasPendingRef = useRef(pending);
  const [open, setOpen] = useState(false);
  const [pickerMenu, setPickerMenu] = useState<"device" | "interval" | "model" | "reasoning" | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    () => deviceAutomations?.[0]?.deviceId ?? ""
  );

  const currentDevice = deviceAutomations?.find((d) => d.deviceId === selectedDeviceId)
    ?? deviceAutomations?.[0];

  const [draft, setDraft] = useState<AutomationOptions>(() => {
    if (currentDevice) {
      return {
        enabledByUser: currentDevice.enabledByUser,
        quotaAware: currentDevice.quotaAware,
        intervalMinutes: (currentDevice.intervalMinutes as IntervalMinutes) || 5,
        model: currentDevice.model || "",
        reasoningEffort: currentDevice.reasoningEffort || "",
        workspacePath: currentDevice.workspacePath ?? "",
      };
    }
    return automationOptions(models, automation);
  });

  useEffect(() => {
    if (currentDevice) {
      setDraft({
        enabledByUser: currentDevice.enabledByUser,
        quotaAware: currentDevice.quotaAware,
        intervalMinutes: (currentDevice.intervalMinutes as IntervalMinutes) || 5,
        model: currentDevice.model || "",
        reasoningEffort: currentDevice.reasoningEffort || "",
        workspacePath: currentDevice.workspacePath ?? "",
      });
    }
  }, [currentDevice]);

  const isOnline = currentDevice?.lastHeartbeatAt
    ? Date.now() - new Date(currentDevice.lastHeartbeatAt).getTime() < 120_000
    : false;

  const status = automation?.status ?? "PAUSED";
  const quota = automation?.quota;
  const idleLabel = automation?.enabledByUser && automation.idleReason === "checking-todos"
    ? text("正在判断待办", "Checking todos")
    : automation?.enabledByUser && automation.idleReason === "waiting-todos"
      ? text("等待任务条件", "Waiting for task conditions")
      : null;

  const deviceSchedule = currentDevice?.scheduleState;
  const applied = deviceSchedule?.appliedSettings;
  const synchronized = Boolean(currentDevice && applied && deviceSchedule?.checkedAt
    && Date.now() - new Date(deviceSchedule.checkedAt).getTime() < 120_000
    && applied.enabledByUser === currentDevice.enabledByUser
    && applied.quotaAware === currentDevice.quotaAware
    && applied.intervalMinutes === currentDevice.intervalMinutes
    && (!currentDevice.model || applied.model === currentDevice.model)
    && (!currentDevice.reasoningEffort || applied.reasoningEffort === currentDevice.reasoningEffort)
    && applied.workspacePath === currentDevice.workspacePath);
  const devicePauseReason = deviceSchedule?.error
    ?? (deviceSchedule?.idleReason === "checking-todos" ? text("正在判斷待辦，排程暫停。", "Checking todos; schedule paused.")
      : deviceSchedule?.idleReason === "waiting-todos" ? text("待辦需要等待，條件解除後重新判斷。", "Tasks must wait; conditions will be checked again.")
      : deviceSchedule?.idleReason === "no-todos" ? text("目前沒有待辦任務。", "No todo tasks.")
      : currentDevice?.quotaAware && deviceSchedule?.quota?.state !== "available" ? text("額度尚未確認可用，排程暫停。", "Quota is not confirmed available; schedule paused.")
      : text("裝置排程已暫停。", "Device schedule paused."));
  const stateLabel = currentDevice
    ? !isOnline ? text("设备离线", "Device offline")
      : !synchronized ? text("等待裝置同步", "Waiting for device sync")
      : deviceSchedule?.error ? text("裝置套用失敗", "Device apply failed")
      : deviceSchedule?.status === "ACTIVE" ? text("裝置排程已啟動", "Device schedule active")
      : deviceSchedule?.status === "PAUSED" ? text("裝置排程已暫停", "Device schedule paused")
      : text("排程狀態未確認", "Schedule status unknown")
    : (idleLabel ?? (!automation?.enabledByUser
      ? text("已暂停", "Paused")
      : automation.quotaAware && quota?.state === "blocked"
        ? text("额度暂停", "Paused by quota")
        : automation.quotaAware && quota?.state === "unavailable"
          ? text("额度不可用", "Quota unavailable")
          : automation.quotaAware && (!quota || quota.state === "unknown")
            ? text("额度未知", "Quota unknown")
            : status === "ACTIVE"
              ? text("运行中", "Running")
              : text("已暂停", "Paused")));
  const availableModels = currentDevice ? currentDevice.lastStatus?.models ?? [] : models;
  const selectedModel = availableModels.find((model) => model.slug === draft.model) ?? (currentDevice ? undefined : availableModels[0]);
  const disabled = pending || currentDevice?.canManage === false || (deviceMode && !currentDevice) || (!currentDevice && (!selectedModel || Boolean(unavailableReason)));

  useEffect(() => {
    if (!open) return;
    if (currentDevice) {
      setDraft({
        enabledByUser: currentDevice.enabledByUser,
        quotaAware: currentDevice.quotaAware,
        intervalMinutes: (currentDevice.intervalMinutes as IntervalMinutes) || 5,
        model: currentDevice.model || "",
        reasoningEffort: currentDevice.reasoningEffort || "",
        workspacePath: currentDevice.workspacePath ?? "",
      });
    } else {
      setDraft(automationOptions(models, automation));
    }
  }, [automation, currentDevice, models, open]);

  useEffect(() => {
    if (!open) setPickerMenu(null);
  }, [open]);

  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      setDraft(currentDevice ? {
        enabledByUser: currentDevice.enabledByUser,
        quotaAware: currentDevice.quotaAware,
        intervalMinutes: currentDevice.intervalMinutes as IntervalMinutes,
        model: currentDevice.model || "",
        reasoningEffort: currentDevice.reasoningEffort || "",
        workspacePath: currentDevice.workspacePath ?? "",
      } : automationOptions(models, automation));
    }
    wasPendingRef.current = pending;
  }, [automation, currentDevice, pending]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 8));
    const top = trigger.bottom + 8 + menu.height <= window.innerHeight
      ? trigger.bottom + 8
      : Math.max(8, trigger.top - menu.height - 8);
    setPosition({ left, top, ready: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const stopOutside = listenForOutsidePointerDown([triggerRef, menuRef], close);
    const stopViewport = listenForMenuViewportChange(menuRef, close);
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !pickerMenu) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      stopOutside();
      stopViewport();
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open, pickerMenu]);

  const submitChange = (next: AutomationOptions) => {
    if (disabled) return;
    setDraft(next);
    if (currentDevice && onDeviceChange) {
      onDeviceChange(currentDevice.deviceId, next);
    } else if (!deviceMode) {
      onChange(next);
    }
  };

  const menu = open ? createPortal(
    <div
      ref={menuRef}
      className="project-automation-menu no-drag"
      role="dialog"
      aria-label={text("自动认领待办设置", "Auto-claim settings")}
      style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden", maxHeight: "calc(100vh - 16px)", overflowY: "auto" }}
    >
      {deviceMode && !currentDevice && !pending && !error && (
        <p>{text("请先新增并配对设备，再设定自动认领。", "Add and pair a device before setting auto-claim.")}</p>
      )}
      <div className="project-automation-menu-heading">
        <strong>{text("自动认领待办", "Auto-claim tasks")}</strong>
        <span className={(currentDevice ? synchronized && isOnline && deviceSchedule?.status === "ACTIVE" : status === "ACTIVE") ? "is-active" : "is-paused"}>
          {stateLabel}
        </span>
      </div>

      {deviceAutomations && deviceAutomations.length > 0 && (
        <div className="project-automation-field" style={{ marginBottom: 8 }}>
          <span>{text("执行设备", "Device")}</span>
          <TaskPropertyPicker
            value={currentDevice?.deviceId ?? ""}
            options={deviceAutomations.map((d) => ({
              value: d.deviceId,
              label: d.deviceName,
              icon: <LinearIcon name="terminal" color="currentColor" width={14} height={14} />,
            }))}
            open={pickerMenu === "device"}
            disabled={disabled}
            className="project-automation-picker"
            triggerClassName="project-automation-picker-trigger"
            ariaLabel={text("执行设备", "Device")}
            onOpenChange={(open) => setPickerMenu(open ? "device" : null)}
            onChange={(value) => {
              setSelectedDeviceId(value);
            }}
          />
        </div>
      )}

      {onOpenDeviceManagement && (
        <div style={{ marginBottom: 12, textAlign: "right" }}>
          <button
            type="button"
            className="text-button"
            style={{ fontSize: 12, color: "var(--color-primary, #3b82f6)", cursor: "pointer", background: "none", border: "none", padding: 0 }}
            onClick={() => {
              setOpen(false);
              onOpenDeviceManagement();
            }}
          >
            {text("管理设备与配对...", "Manage devices...")}
          </button>
        </div>
      )}

      {currentDevice && (
        <label className="project-automation-switch">
          <span>{text("此设备的项目目录", "Project folder on this device")}</span>
          <input
            aria-label={text("此设备的项目目录", "Project folder on this device")}
            value={draft.workspacePath ?? ""}
            placeholder="/absolute/path/to/project"
            disabled={pending}
            onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })}
            onBlur={() => {
              if (draft.workspacePath !== (currentDevice.workspacePath ?? "")) submitChange(draft);
            }}
          />
        </label>
      )}
      <div className="project-automation-switch">
        <span>{text("自动认领开关", "Auto-claim")}</span>
        <button
          type="button"
          className={`board-setting-switch${draft.enabledByUser ? " is-on" : ""}`}
          role="switch"
          aria-checked={draft.enabledByUser}
          disabled={disabled}
          onClick={() => submitChange({
            ...draft,
            enabledByUser: !draft.enabledByUser,
          })}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div className="project-automation-switch">
        <span>{text("根据额度启用/关闭", "Use quota limits")}</span>
        <button
          type="button"
          className={`board-setting-switch${draft.quotaAware ? " is-on" : ""}`}
          role="switch"
          aria-checked={draft.quotaAware}
          disabled={disabled}
          onClick={() => submitChange({
            ...draft,
            quotaAware: !draft.quotaAware,
          })}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {currentDevice && draft.quotaAware && (
        <p className="project-automation-note">{text("额度会在执行设备上检查。", "Quota is checked on the execution device.")}</p>
      )}
      {currentDevice && !selectedModel && (
        <p className="project-automation-note">{text("模型", "Model")} · {draft.model || text("等待设备回报可用模型", "Waiting for the device model catalog")}</p>
      )}
      {!currentDevice && draft.quotaAware && (
        <div className={`project-automation-quota is-${quota?.state ?? "unknown"}`}>
          {quota?.state === "available" && text("当前额度可用", "Quota is available")}
          {quota?.state === "blocked" && (
            quota.resetsAt
              ? text(
                `额度已用尽，预计 ${formatResetTime(quota.resetsAt, locale)} 恢复`,
                `Quota is exhausted. Expected reset: ${formatResetTime(quota.resetsAt, locale)}.`,
              )
              : text("额度已用尽，自动认领已暂停", "Quota is exhausted. Auto-claim is paused.")
          )}
          {quota?.state === "unavailable" && (
            quota.reason === "api-key"
              ? text(
                "API Key 模式不支持读取 Codex App 额度",
                "API key mode cannot read the Codex app quota.",
              )
              : text("当前账户无法读取额度", "This account cannot read quota information.")
          )}
          {(!quota || quota.state === "unknown") && text(
            "额度状态未知，自动认领已暂停",
            "Quota status is unknown. Auto-claim is paused.",
          )}
        </div>
      )}
      <div className="project-automation-field">
        <span>{text("间隔", "Interval")}</span>
        <TaskPropertyPicker
          value={String(draft.intervalMinutes)}
          options={[5, 10, 15, 30, 60].map((minutes) => ({
            value: String(minutes),
            label: text(`${minutes} 分钟`, `${minutes} min`),
            icon: <RecurrenceIcon color="currentColor" size={14} />,
          }))}
          open={pickerMenu === "interval"}
          disabled={disabled}
          className="project-automation-picker"
          triggerClassName="project-automation-picker-trigger"
          ariaLabel={text("间隔", "Interval")}
          onOpenChange={(open) => setPickerMenu(open ? "interval" : null)}
          onChange={(value) => submitChange({
            ...draft,
            intervalMinutes: Number(value) as IntervalMinutes,
          })}
        />
      </div>
      {availableModels.length > 0 && (
        <>
          <div className="project-automation-field">
            <span>{text("模型", "Model")}</span>
            <TaskPropertyPicker
              value={currentDevice ? draft.model : draft.model || selectedModel?.slug || ""}
              options={[...(currentDevice ? [{
                value: "", label: text("使用裝置預設", "Use device default"),
                icon: <ProjectIcon color="currentColor" size={14} />,
              }] : []), ...availableModels.map((model) => ({
                value: model.slug,
                label: model.displayName,
                icon: <ProjectIcon color="currentColor" size={14} />,
              }))]}
              open={pickerMenu === "model"}
              disabled={disabled}
              className="project-automation-picker"
              triggerClassName="project-automation-picker-trigger"
              ariaLabel={text("模型", "Model")}
              onOpenChange={(open) => setPickerMenu(open ? "model" : null)}
              onChange={(value) => {
                if (currentDevice && !value) {
                  submitChange({ ...draft, model: "", reasoningEffort: "" });
                  return;
                }
                const model = availableModels.find((candidate) => candidate.slug === value);
                if (!model) return;
                submitChange({
                  ...draft,
                  model: value,
                  reasoningEffort: model.supportedReasoningEfforts.includes(draft.reasoningEffort)
                    ? draft.reasoningEffort
                    : model.defaultReasoningEffort,
                });
              }}
            />
          </div>
          {selectedModel && <div className="project-automation-field">
            <span>{text("推理强度", "Reasoning effort")}</span>
            <TaskPropertyPicker
              value={draft.reasoningEffort || selectedModel.defaultReasoningEffort}
              options={selectedModel.supportedReasoningEfforts.map((effort) => ({
                value: effort,
                label: EFFORT_LABELS[effort] ? text(...EFFORT_LABELS[effort]) : effort,
                icon: <LinearIcon name="displayOptions" />,
              }))}
              open={pickerMenu === "reasoning"}
              disabled={disabled}
              className="project-automation-picker"
              triggerClassName="project-automation-picker-trigger"
              ariaLabel={text("推理强度", "Reasoning effort")}
              onOpenChange={(open) => setPickerMenu(open ? "reasoning" : null)}
              onChange={(value) => submitChange({
                ...draft,
                reasoningEffort: value,
              })}
            />
          </div>}
        </>
      )}
      {currentDevice && (
        <div className="project-automation-note" role="status" style={{ overflowWrap: "anywhere" }}>
          {currentDevice.canManage === false && <p>{text("目前以裝置身分連線，設定請在雲端網站登入後修改。", "Connected as a device; sign in to the cloud website to change settings.")}</p>}
          <p>{text("雲端設定", "Cloud setting")} · {currentDevice.enabledByUser ? text("自動認領已開啟", "Auto-claim enabled") : text("自動認領已關閉", "Auto-claim disabled")}</p>
          <p>{text("裝置排程", "Device schedule")} · {isOnline && synchronized ? deviceSchedule?.status ?? "UNKNOWN" : text("尚未確認", "Unconfirmed")}</p>
          {!synchronized && <p>{text("等待裝置回報與目前設定相符的結果。", "Waiting for the device to confirm the current settings.")}</p>}
          {deviceSchedule?.error && <p role="alert">{deviceSchedule.error}</p>}
          {synchronized && deviceSchedule?.status === "PAUSED" && <p>{devicePauseReason}</p>}
          <p>{text("最後心跳", "Last heartbeat")} · {currentDevice.lastHeartbeatAt ? new Date(currentDevice.lastHeartbeatAt).toLocaleString(locale) : text("尚無回報", "Not reported")}</p>
          <p>{text("排程確認時間", "Schedule confirmed at")} · {deviceSchedule?.checkedAt ? new Date(deviceSchedule.checkedAt).toLocaleString(locale) : text("尚無回報", "Not reported")}</p>
          <p>{text("下次執行", "Next run")} · {isOnline && synchronized && deviceSchedule?.status === "ACTIVE" && deviceSchedule.nextRunAt ? new Date(deviceSchedule.nextRunAt).toLocaleString(locale) : text("尚未安排", "Not scheduled")}</p>
          <p>{text("額度狀態", "Quota state")} · {deviceSchedule?.quota?.state ?? text("尚未回報", "Not reported")}</p>
          {deviceSchedule?.quota?.resetsAt && <p>{text("額度重置時間", "Quota reset")} · {new Date(deviceSchedule.quota.resetsAt * 1000).toLocaleString(locale)}</p>}
          {applied && <p>{text("裝置已套用", "Applied on device")} · {applied.model} · {applied.reasoningEffort} · {text(`${applied.intervalMinutes} 分鐘`, `${applied.intervalMinutes} min`)}</p>}
          {applied && <p>{text("執行目錄", "Workspace")} · {applied.workspacePath}</p>}
          {deviceSchedule?.automationId && <p>{text("排程 ID", "Schedule ID")} · {deviceSchedule.automationId}</p>}
        </div>
      )}
      {idleLabel && (
        <p className="project-automation-note" role="status">
          {automation?.idleReason === "waiting-todos"
            ? text(
              "当前待办任务都需要等待，已暂停本轮自动认领。新增可执行任务，或更新任务说明、最新评论后，将自动重新判断。",
              "Current tasks need to wait, so auto-claim is paused for now. New actionable tasks or changes to task descriptions or latest comments will trigger a new check.",
            )
            : text(
              "正在确认待办任务是否可以开始，确认前暂停自动认领。",
              "Checking whether tasks can start. Auto-claim is paused until the check is complete.",
            )}
        </p>
      )}
      {!deviceMode && !currentDevice && unavailableReason && <p className="project-automation-note">{unavailableReason}</p>}
      {error && (currentDevice || deviceMode || error !== unavailableReason) && <p className="project-automation-error" role="alert">{error}</p>}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`project-automation-trigger no-drag ${status === "ACTIVE" ? "is-active" : "is-paused"}`}
        aria-label={idleLabel ?? (status === "ACTIVE"
          ? text("自动认领中", "Auto-claiming")
          : text("自动化", "Automation"))}
        aria-busy={pending}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={idleLabel ?? (status === "ACTIVE"
          ? text("自动认领中", "Auto-claiming")
          : text("自动化", "Automation"))}
        onClick={() => {
          if (!open) {
            setPosition((current) => ({ ...current, ready: false }));
            onOpen();
          }
          setOpen((current) => !current);
        }}
      >
        <TaskboardIcon name={status === "ACTIVE" ? "automationPause" : "automationPlay"} />
        <span>{idleLabel ?? (status === "ACTIVE"
          ? text("自动认领中", "Auto-claiming")
          : text("自动化", "Automation"))}</span>
      </button>
      {menu}
    </>
  );
}

function formatResetTime(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1_000));
}
