/**
 * Agent Dispatch — routes agent execution to container or host runner
 * based on the group's execution mode.
 */
import { ChildProcess } from 'child_process';

import {
  ContainerInput,
  ContainerOutput,
  runContainerAgent,
} from './container-runner.js';
import { runHostAgent } from './host-runner.js';
import { RegisteredGroup } from './types.js';

export async function runAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, name: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  if (group.execution === 'host') {
    return runHostAgent(group, input, onProcess, onOutput);
  }
  return runContainerAgent(group, input, onProcess, onOutput);
}
