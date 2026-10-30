/**
 * Host bridge call shape shared by the desktop services.
 *
 * The preload bridge exposes exactly one generic entry point; the renderer
 * narrows payloads per contract method. Keeping the type in its own module
 * stops the service factories from depending on each other.
 */
export type HostCall = (method: string, payload: unknown) => Promise<unknown>;
