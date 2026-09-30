// Written here, not vendored: the parts of the survey's @myself/narrative that
// the release builder and the survey editor use. The survey's own index also
// exports the model runner (runner.ts, records.ts, quality.ts), which the
// dashboard never runs. Every file this re-exports is vendored verbatim.
export * from "./protocol.js";
export * from "./config.js";
export * from "./prompts.js";
export * from "./protocols.js";
