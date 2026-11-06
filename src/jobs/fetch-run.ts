import { orchestrate } from './orchestrate';
import { stepIo } from './steps';

// The durable job behind the Fetch button. All the logic is in orchestrate(); every call it makes is a workflow step.
export async function fetchRunWorkflow(runId: number, limit: number): Promise<void> {
  'use workflow';
  await orchestrate(stepIo, runId, limit);
}
