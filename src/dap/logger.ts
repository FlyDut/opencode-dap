const disabled = typeof process !== "undefined" && process.env.DAP_DEBUG_DISABLE === "1";

function nop(..._args: unknown[]): void {}

export const warn = disabled ? nop : console.warn.bind(console);
export const debug = disabled ? nop : console.debug.bind(console);
export const error = disabled ? nop : console.error.bind(console);
