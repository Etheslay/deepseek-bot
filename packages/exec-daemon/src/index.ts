export {
  createScreenBackend,
  type CaptureResult,
  type ScreenBackend,
  type ScreenBackendOptions,
} from "./backend.js";
export { ScreenBackendError, type ScreenBackendCode } from "./errors.js";
export {
  allowedVirtualKeys,
  createDeviceInputBackend,
  createPowerShellInputRunner,
  DEVICE_KEY_CODES,
  helperRequest,
  inputLaunch,
  inputScriptPath,
  parseDeviceInputFailure,
  unavailableDeviceInputBackend,
  type DeviceHelperRequest,
  type DeviceInputBackend,
  type DeviceInputRequest,
  type DeviceInputRunner,
} from "./input.js";
export type { ListedWindow, WindowIdentity } from "./windows.js";
