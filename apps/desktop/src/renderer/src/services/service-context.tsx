/**
 * React context providing the DesktopService to all features.
 * Components never import the fixture implementation directly; tests may
 * inject a stub service through the provider.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createFixtureService } from "./fixture-service.js";
import type { DesktopService } from "./desktop-service.js";

const ServiceContext = createContext<DesktopService | null>(null);

export function ServiceProvider(
  props:
    | { children: ReactNode; service?: DesktopService }
    | { children: ReactNode; service: DesktopService },
): React.JSX.Element {
  const service = useMemo(
    () => props.service ?? createFixtureService(),
    [props.service],
  );
  return (
    <ServiceContext.Provider value={service}>{props.children}</ServiceContext.Provider>
  );
}

export function useService(): DesktopService {
  const service = useContext(ServiceContext);
  if (!service) {
    throw new Error("useService must be used inside <ServiceProvider>");
  }
  return service;
}
