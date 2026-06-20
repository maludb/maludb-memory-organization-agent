export * from "./job-types.js";
export * from "./events.js";

// TODO(job-contracts): add a Zod schema per JobType for the job payload + result.
// Validate at enqueue (agent-api) and at dequeue (worker) so producer and consumer
// share one source of truth. See docs/worker-design.md (inputs/outputs per job) and
// docs/api-contract.md (endpoint request/response shapes).
